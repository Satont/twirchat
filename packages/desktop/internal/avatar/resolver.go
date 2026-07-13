// Package avatar resolves chat author avatar URLs without making the renderer
// wait for provider I/O.
package avatar

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

const (
	defaultPositiveTTL = 24 * time.Hour
	defaultNegativeTTL = 10 * time.Minute
	defaultMaxEntries  = 1_000
)

// Config controls the process-local cache. TTLs are configurable to keep the
// resolver deterministic under tests without exposing cache internals.
type Config struct {
	Backend     *backend.HTTPClient
	MaxEntries  int
	NegativeTTL time.Duration
	PositiveTTL time.Duration
}

type cacheEntry struct {
	createdAt time.Time
	expiresAt time.Time
	result    contracts.AvatarResolution
}

type inFlightCall struct {
	done   chan struct{}
	err    error
	result contracts.AvatarResolution
}

// Resolver deduplicates concurrent lookups and keeps both successful and
// empty results in a bounded in-memory cache for the desktop session.
type Resolver struct {
	backend     *backend.HTTPClient
	maxEntries  int
	negativeTTL time.Duration
	positiveTTL time.Duration

	mu       sync.Mutex
	cache    map[string]cacheEntry
	inFlight map[string]*inFlightCall
}

func NewResolver(config Config) (*Resolver, error) {
	if config.Backend == nil {
		return nil, errors.New("create avatar resolver: backend client is required")
	}
	if config.MaxEntries <= 0 {
		config.MaxEntries = defaultMaxEntries
	}
	if config.PositiveTTL <= 0 {
		config.PositiveTTL = defaultPositiveTTL
	}
	if config.NegativeTTL <= 0 {
		config.NegativeTTL = defaultNegativeTTL
	}
	return &Resolver{
		backend:     config.Backend,
		cache:       make(map[string]cacheEntry),
		inFlight:    make(map[string]*inFlightCall),
		maxEntries:  config.MaxEntries,
		negativeTTL: config.NegativeTTL,
		positiveTTL: config.PositiveTTL,
	}, nil
}

// Resolve returns a cached result immediately when possible. The first caller
// performs the backend lookup outside the mutex; concurrent callers wait for
// that same lookup rather than issuing duplicate provider requests.
func (r *Resolver) Resolve(
	ctx context.Context,
	input contracts.ResolveAvatarParams,
) (contracts.AvatarResolution, error) {
	key, err := avatarKey(input)
	if err != nil {
		return contracts.AvatarResolution{}, err
	}

	now := time.Now()
	r.mu.Lock()
	if cached, found := r.cache[key]; found {
		if now.Before(cached.expiresAt) {
			r.mu.Unlock()
			return cached.result, nil
		}
		delete(r.cache, key)
	}
	if call, found := r.inFlight[key]; found {
		r.mu.Unlock()
		select {
		case <-ctx.Done():
			return contracts.AvatarResolution{}, fmt.Errorf("resolve avatar: %w", ctx.Err())
		case <-call.done:
			return call.result, call.err
		}
	}
	call := &inFlightCall{done: make(chan struct{})}
	r.inFlight[key] = call
	r.mu.Unlock()

	result, err := r.fetch(ctx, input)

	r.mu.Lock()
	if err == nil {
		r.storeLocked(key, result, now)
	}
	call.result = result
	call.err = err
	delete(r.inFlight, key)
	close(call.done)
	r.mu.Unlock()

	return result, err
}

func (r *Resolver) fetch(
	ctx context.Context,
	input contracts.ResolveAvatarParams,
) (contracts.AvatarResolution, error) {
	switch input.Platform {
	case contracts.PlatformTwitch:
		var response struct {
			User *struct {
				ProfileImageURL string `json:"profile_image_url"`
			} `json:"user"`
		}
		path := "/api/twitch/user?userId=" + url.QueryEscape(input.AuthorID)
		if err := r.backend.GetJSON(ctx, path, &response); err != nil {
			return contracts.AvatarResolution{}, fmt.Errorf("resolve Twitch avatar: %w", err)
		}
		if response.User == nil {
			return contracts.AvatarResolution{}, nil
		}
		return contracts.AvatarResolution{AvatarURL: strings.TrimSpace(response.User.ProfileImageURL)}, nil
	case contracts.PlatformKick:
		var response struct {
			AvatarURL string `json:"avatarUrl"`
		}
		path := "/api/kick/chatroom?slug=" + url.QueryEscape(input.Username)
		if err := r.backend.GetJSON(ctx, path, &response); err != nil {
			return contracts.AvatarResolution{}, fmt.Errorf("resolve Kick avatar: %w", err)
		}
		return contracts.AvatarResolution{AvatarURL: strings.TrimSpace(response.AvatarURL)}, nil
	default:
		return contracts.AvatarResolution{}, fmt.Errorf("resolve avatar: unsupported platform %q", input.Platform)
	}
}

func (r *Resolver) storeLocked(key string, result contracts.AvatarResolution, now time.Time) {
	if len(r.cache) >= r.maxEntries {
		r.evictOldestLocked()
	}
	ttl := r.positiveTTL
	if result.AvatarURL == "" {
		ttl = r.negativeTTL
	}
	r.cache[key] = cacheEntry{createdAt: now, expiresAt: now.Add(ttl), result: result}
}

func (r *Resolver) evictOldestLocked() {
	var oldestKey string
	var oldest time.Time
	for key, entry := range r.cache {
		if oldestKey == "" || entry.createdAt.Before(oldest) {
			oldestKey = key
			oldest = entry.createdAt
		}
	}
	if oldestKey != "" {
		delete(r.cache, oldestKey)
	}
}

func avatarKey(input contracts.ResolveAvatarParams) (string, error) {
	if input.AuthorID == "" {
		return "", errors.New("resolve avatar: author ID is required")
	}
	if input.Platform != contracts.PlatformTwitch && input.Platform != contracts.PlatformKick {
		return "", fmt.Errorf("resolve avatar: unsupported platform %q", input.Platform)
	}
	if input.Platform == contracts.PlatformKick && strings.TrimSpace(input.Username) == "" {
		return "", errors.New("resolve Kick avatar: username is required")
	}
	return string(input.Platform) + ":" + input.AuthorID, nil
}
