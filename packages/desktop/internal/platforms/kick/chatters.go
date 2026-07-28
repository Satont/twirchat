package kick

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

const (
	activeChattersTimeout     = 10 * time.Second
	maxActiveChattersBodySize = 4 << 20
)

type activeChattersResponse struct {
	Data *activeChattersData `json:"data"`
}

type activeChattersData struct {
	Bots       *[]kickChatter `json:"bots"`
	Chatters   *[]kickChatter `json:"chatters"`
	Moderators *[]kickChatter `json:"moderators"`
	Ogs        *[]kickChatter `json:"ogs"`
	Vips       *[]kickChatter `json:"vips"`
}

type kickChatter struct {
	ProfilePicture string `json:"profile_picture"`
	Slug           string `json:"slug"`
	Username       string `json:"username"`
}

func (s *Service) Chatters(ctx context.Context, channelSlug string) (contracts.WatchedChannelChatters, error) {
	channelSlug = normalize(channelSlug)
	if channelSlug == "" {
		return contracts.WatchedChannelChatters{}, errors.New("Kick chatters are currently unavailable.: channel slug is required")
	}

	broadcasterID, found := s.cachedChannelID(channelSlug)
	if !found {
		var err error
		broadcasterID, err = s.resolveChatterChannel(ctx, channelSlug)
		if err != nil {
			return contracts.WatchedChannelChatters{}, err
		}
	}

	body, err := s.fetchActiveChatters(ctx, channelSlug, broadcasterID)
	if err != nil {
		return contracts.WatchedChannelChatters{}, err
	}
	return normalizeActiveChatters(channelSlug, body)
}

func (s *Service) cachedChannelID(channelSlug string) (int64, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	broadcasterID := s.channels[channelSlug]
	return broadcasterID, broadcasterID != 0
}

func (s *Service) cacheChannelIDs(channelSlug string, broadcasterID, chatroomID int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.channels[channelSlug] = broadcasterID
	s.chatrooms[channelSlug] = chatroomID
}

func (s *Service) resolveChatterChannel(ctx context.Context, channelSlug string) (int64, error) {
	var response kickChatroom
	path := "/api/kick/chatroom?slug=" + url.QueryEscape(channelSlug)
	if err := s.backend.GetJSON(ctx, path, &response); err != nil {
		return 0, fmt.Errorf("Kick chatters are currently unavailable.: resolve channel: %w", err)
	}
	if response.BroadcasterUserID <= 0 {
		return 0, errors.New("Kick chatters are currently unavailable.: backend returned no broadcaster ID")
	}
	s.cacheChannelIDs(channelSlug, response.BroadcasterUserID, response.ChatroomID)
	return response.BroadcasterUserID, nil
}

func (s *Service) fetchActiveChatters(ctx context.Context, channelSlug string, broadcasterID int64) ([]byte, error) {
	requestContext, cancel := context.WithTimeout(ctx, activeChattersTimeout)
	defer cancel()
	endpoint := strings.TrimRight(s.activeChattersURL, "/") + "/" + strconv.FormatInt(broadcasterID, 10) + "/chat/active-chatters"
	request, err := http.NewRequestWithContext(requestContext, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("Kick chatters are currently unavailable.: create request: %w", err)
	}
	request.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Accept-Language", "en-US,en;q=0.9")
	request.Header.Set("Origin", "https://kick.com")
	request.Header.Set("Referer", "https://kick.com/"+channelSlug)

	response, err := s.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("Kick chatters are currently unavailable.: request failed: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxActiveChattersBodySize+1))
	if err != nil {
		return nil, fmt.Errorf("Kick chatters are currently unavailable.: read response: %w", err)
	}
	if len(body) > maxActiveChattersBodySize {
		return nil, errors.New("Kick chatters are currently unavailable.: response exceeded 4 MiB limit")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("Kick chatters are currently unavailable.: upstream returned HTTP %d", response.StatusCode)
	}
	trimmedBody := bytes.TrimSpace(body)
	if bytes.HasPrefix(trimmedBody, []byte("<")) || strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "text/html") {
		return nil, errors.New("Kick chatters are currently unavailable.: upstream returned an HTML challenge page")
	}
	return body, nil
}

func normalizeActiveChatters(channelSlug string, body []byte) (contracts.WatchedChannelChatters, error) {
	var response activeChattersResponse
	decoder := json.NewDecoder(bytes.NewReader(body))
	if err := decoder.Decode(&response); err != nil {
		return contracts.WatchedChannelChatters{}, fmt.Errorf("Kick chatters are currently unavailable.: decode response: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return contracts.WatchedChannelChatters{}, errors.New("Kick chatters are currently unavailable.: response contains trailing JSON")
		}
		return contracts.WatchedChannelChatters{}, fmt.Errorf("Kick chatters are currently unavailable.: decode response: %w", err)
	}
	if response.Data == nil || response.Data.Bots == nil || response.Data.Chatters == nil ||
		response.Data.Moderators == nil || response.Data.Ogs == nil || response.Data.Vips == nil {
		return contracts.WatchedChannelChatters{}, errors.New("Kick chatters are currently unavailable.: response has an invalid data shape")
	}

	result := contracts.WatchedChannelChatters{
		Platform:    contracts.PlatformKick,
		ChannelSlug: channelSlug,
		Groups: []contracts.ChatterGroup{
			{Role: contracts.ChatterRoleModerators, Users: []contracts.ChatterUser{}},
			{Role: contracts.ChatterRoleVips, Users: []contracts.ChatterUser{}},
			{Role: contracts.ChatterRoleOgs, Users: []contracts.ChatterUser{}},
			{Role: contracts.ChatterRoleBots, Users: []contracts.ChatterUser{}},
			{Role: contracts.ChatterRoleChatters, Users: []contracts.ChatterUser{}},
		},
	}
	groups := []struct {
		chatters []kickChatter
	}{
		{chatters: *response.Data.Moderators},
		{chatters: *response.Data.Vips},
		{chatters: *response.Data.Ogs},
		{chatters: *response.Data.Bots},
		{chatters: *response.Data.Chatters},
	}

	seen := make(map[string]struct{})
	for index, group := range groups {
		for _, chatter := range group.chatters {
			slug := strings.TrimSpace(chatter.Slug)
			username := strings.TrimSpace(chatter.Username)
			identity := slug
			if identity == "" {
				identity = username
			}
			if identity == "" {
				return contracts.WatchedChannelChatters{}, errors.New("Kick chatters are currently unavailable.: chatter has no username")
			}
			key := strings.ToLower(identity)
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			if username == "" {
				username = slug
			}
			if slug == "" {
				slug = username
			}
			result.Groups[index].Users = append(result.Groups[index].Users, contracts.ChatterUser{
				Username: slug, DisplayName: username, AvatarURL: strings.TrimSpace(chatter.ProfilePicture),
			})
		}
	}
	result.Total = len(seen)
	return result, nil
}
