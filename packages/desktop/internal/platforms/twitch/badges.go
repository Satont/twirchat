package twitch

import (
	"context"
	"fmt"
	"net/url"
	"sync"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

const badgeCacheTTL = 5 * time.Minute

type BadgeResolver interface {
	Resolve(context.Context, string, []contracts.Badge) ([]contracts.Badge, error)
}

type badgeCacheEntry struct {
	badges    map[string]string
	expiresAt time.Time
}

type BackendBadgeResolver struct {
	client *backend.HTTPClient
	mu     sync.Mutex
	cache  map[string]badgeCacheEntry
}

func NewBackendBadgeResolver(client *backend.HTTPClient) *BackendBadgeResolver {
	return &BackendBadgeResolver{client: client, cache: make(map[string]badgeCacheEntry)}
}

func (r *BackendBadgeResolver) Resolve(ctx context.Context, channel string, badges []contracts.Badge) ([]contracts.Badge, error) {
	if len(badges) == 0 {
		return []contracts.Badge{}, nil
	}
	channel = normalizeChannel(channel)
	if channel == "" {
		return nil, fmt.Errorf("resolve Twitch badges: channel is required")
	}
	registry, err := r.registry(ctx, channel)
	if err != nil {
		return nil, err
	}
	resolved := append([]contracts.Badge(nil), badges...)
	for index := range resolved {
		resolved[index].ImageURL = registry[resolved[index].ID]
	}
	return resolved, nil
}

func (r *BackendBadgeResolver) registry(ctx context.Context, channel string) (map[string]string, error) {
	now := time.Now()
	r.mu.Lock()
	entry, found := r.cache[channel]
	r.mu.Unlock()
	if found && now.Before(entry.expiresAt) {
		return entry.badges, nil
	}
	var response struct {
		Badges map[string]string `json:"badges"`
	}
	path := "/api/twitch/badges?" + url.Values{"broadcasterLogin": []string{channel}}.Encode()
	if err := r.client.GetJSON(ctx, path, &response); err != nil {
		return nil, fmt.Errorf("fetch Twitch badge registry for %q: %w", channel, err)
	}
	if response.Badges == nil {
		response.Badges = map[string]string{}
	}
	r.mu.Lock()
	r.cache[channel] = badgeCacheEntry{badges: response.Badges, expiresAt: now.Add(badgeCacheTTL)}
	r.mu.Unlock()
	return response.Badges, nil
}

type passthroughBadgeResolver struct{}

func (passthroughBadgeResolver) Resolve(_ context.Context, _ string, badges []contracts.Badge) ([]contracts.Badge, error) {
	return append([]contracts.Badge(nil), badges...), nil
}
func broadcasterBadge() contracts.Badge {
	return contracts.Badge{ID: "broadcaster/1", Type: "broadcaster", Text: "broadcaster"}
}
