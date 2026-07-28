package twitch

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/Satont/twirchat/packages/desktop/internal/auth"
	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

const (
	chattersScopeRequired = "moderator:read:chatters"
	chattersUnauthorized  = "Reconnect Twitch to grant moderator:read:chatters."
	chattersForbidden     = "You must be a moderator or broadcaster to view this Twitch chatters list."
	chattersNotFound      = "Twitch channel not found."
	chattersUnavailable   = "Twitch chatters are currently unavailable."
)

type twitchChattersResponse struct {
	BroadcasterID string          `json:"broadcasterId"`
	Chatters      []twitchChatter `json:"chatters"`
}

type twitchChatter struct {
	UserID    string `json:"userId"`
	UserLogin string `json:"userLogin"`
	UserName  string `json:"userName"`
	AvatarURL string `json:"avatarUrl"`
}

func (s *Service) Chatters(ctx context.Context, channelSlug string) (contracts.WatchedChannelChatters, error) {
	channelSlug = normalizeChannel(channelSlug)
	if channelSlug == "" {
		return contracts.WatchedChannelChatters{}, errors.New(chattersUnavailable)
	}

	account, err := s.storage.FindAccountByPlatform(ctx, contracts.PlatformTwitch)
	if err != nil {
		return contracts.WatchedChannelChatters{}, errors.New(chattersUnavailable)
	}
	if account == nil {
		return contracts.WatchedChannelChatters{}, errors.New("authenticate with Twitch before viewing chatters")
	}
	if !hasScope(account.Scopes, chattersScopeRequired) {
		return contracts.WatchedChannelChatters{}, errors.New(chattersUnauthorized)
	}
	if s.backend == nil || account.PlatformUserID == "" {
		return contracts.WatchedChannelChatters{}, errors.New(chattersUnavailable)
	}

	tokens, found, err := auth.EnsureFreshTokens(ctx, s.storage, s.tokenRefresher(), account.ID)
	if err != nil || !found || tokens.AccessToken == "" {
		return contracts.WatchedChannelChatters{}, errors.New(chattersUnavailable)
	}
	response, err := s.postChatters(ctx, tokens.AccessToken, channelSlug, account.PlatformUserID)
	if err != nil && isUnauthorizedBackendError(err) && s.refreshAccount(ctx, account.ID) {
		tokens, found, err = auth.ReloadTokens(ctx, s.storage, account.ID)
		if err == nil && found && tokens.AccessToken != "" {
			response, err = s.postChatters(ctx, tokens.AccessToken, channelSlug, account.PlatformUserID)
		}
	}
	if err != nil {
		return contracts.WatchedChannelChatters{}, chattersRequestError(err)
	}
	return normalizeChatters(channelSlug, response), nil
}

func (s *Service) postChatters(
	ctx context.Context,
	accessToken, channelSlug, moderatorID string,
) (twitchChattersResponse, error) {
	var response twitchChattersResponse
	request := struct {
		AccessToken      string `json:"accessToken"`
		BroadcasterLogin string `json:"broadcasterLogin"`
		ModeratorID      string `json:"moderatorId"`
	}{AccessToken: accessToken, BroadcasterLogin: channelSlug, ModeratorID: moderatorID}
	if err := s.backend.PostJSON(ctx, "/api/twitch/chatters", request, &response); err != nil {
		return twitchChattersResponse{}, err
	}
	return response, nil
}

func normalizeChatters(channelSlug string, response twitchChattersResponse) contracts.WatchedChannelChatters {
	broadcaster := contracts.ChatterGroup{Role: contracts.ChatterRoleBroadcaster, Users: []contracts.ChatterUser{}}
	chatters := contracts.ChatterGroup{Role: contracts.ChatterRoleChatters, Users: []contracts.ChatterUser{}}
	seen := make(map[string]struct{}, len(response.Chatters))
	for _, chatter := range response.Chatters {
		user := contracts.ChatterUser{
			UserID: chatter.UserID, Username: chatter.UserLogin, DisplayName: chatter.UserName,
			AvatarURL: chatter.AvatarURL,
		}
		if chatter.UserID == response.BroadcasterID {
			if len(broadcaster.Users) == 0 {
				broadcaster.Users = append(broadcaster.Users, user)
			}
			continue
		}
		if _, exists := seen[chatter.UserID]; exists {
			continue
		}
		seen[chatter.UserID] = struct{}{}
		chatters.Users = append(chatters.Users, user)
	}

	return contracts.WatchedChannelChatters{
		Platform: contracts.PlatformTwitch, ChannelSlug: channelSlug,
		Total: len(broadcaster.Users) + len(chatters.Users), Groups: []contracts.ChatterGroup{broadcaster, chatters},
	}
}

func chattersRequestError(err error) error {
	var statusError *backend.HTTPStatusError
	if !errors.As(err, &statusError) {
		return errors.New(chattersUnavailable)
	}
	switch statusError.StatusCode {
	case http.StatusUnauthorized:
		return errors.New(chattersUnauthorized)
	case http.StatusForbidden:
		return errors.New(chattersForbidden)
	case http.StatusNotFound:
		var payload struct {
			Error string `json:"error"`
		}
		if json.Unmarshal([]byte(statusError.Body), &payload) == nil && payload.Error != "" {
			return errors.New(payload.Error)
		}
		return errors.New(chattersNotFound)
	default:
		return errors.New(chattersUnavailable)
	}
}
