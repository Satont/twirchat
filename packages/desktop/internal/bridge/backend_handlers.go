package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

// RegisterBackendHandlers connects Vue's backend-routed read operations to the
// authenticated Go HTTP client.
func RegisterBackendHandlers(
	registry *HandlerRegistry,
	client *backend.HTTPClient,
	store *storage.Storage,
) {
	registry.Register(contracts.RequestGetUserCardMetadata, func(ctx context.Context, params any) (any, error) {
		var input contracts.UserCardMetadataParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		if input.Platform != contracts.PlatformTwitch && input.Platform != contracts.PlatformKick {
			return nil, fmt.Errorf("get user card metadata: unsupported platform %q", input.Platform)
		}
		if input.PlatformUserID == "" {
			return nil, fmt.Errorf("get user card metadata: platform user ID is required")
		}
		body := map[string]any{
			"platform": input.Platform, "platformUserId": input.PlatformUserID, "username": input.Username,
			"channelId": input.ChannelID, "channelSlug": input.ChannelSlug,
		}
		if input.Platform == contracts.PlatformTwitch {
			account, err := store.FindAccountByPlatform(ctx, contracts.PlatformTwitch)
			if err != nil {
				return nil, fmt.Errorf("get user card metadata: find Twitch account: %w", err)
			}
			if account != nil {
				tokens, found, err := store.AccountTokens(ctx, account.ID)
				if err != nil {
					return nil, fmt.Errorf("get user card metadata: read Twitch token: %w", err)
				}
				if found {
					body["twitchAuth"] = map[string]any{
						"accessToken": tokens.AccessToken, "platformUserId": account.PlatformUserID, "scopes": account.Scopes,
					}
				}
			}
		}
		var response json.RawMessage
		if err := client.PostJSON(ctx, "/api/user-card-metadata", body, &response); err != nil {
			return nil, fmt.Errorf("get user card metadata: %w", err)
		}
		var metadata map[string]any
		if err := json.Unmarshal(response, &metadata); err != nil {
			return nil, fmt.Errorf("get user card metadata: decode backend response: %w", err)
		}
		return metadata, nil
	})
	registry.Register(contracts.RequestGetStreamStatus, func(ctx context.Context, params any) (any, error) {
		var input contracts.StreamStatusParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		if input.Platform != contracts.PlatformTwitch && input.Platform != contracts.PlatformKick {
			return nil, fmt.Errorf("get stream status: unsupported platform %q", input.Platform)
		}
		var response struct {
			IsLive       bool   `json:"isLive"`
			Title        string `json:"title"`
			CategoryID   string `json:"categoryId"`
			CategoryName string `json:"categoryName"`
			ViewerCount  *int   `json:"viewerCount"`
		}
		path := "/api/stream-status?" + url.Values{
			"platform":  []string{string(input.Platform)},
			"channelId": []string{input.ChannelID},
		}.Encode()
		if err := client.GetJSON(ctx, path, &response); err != nil {
			return nil, fmt.Errorf("get stream status: %w", err)
		}
		return contracts.StreamStatus{
			Platform:     input.Platform,
			ChannelID:    input.ChannelID,
			IsLive:       response.IsLive,
			Title:        response.Title,
			CategoryID:   response.CategoryID,
			CategoryName: response.CategoryName,
			ViewerCount:  response.ViewerCount,
		}, nil
	})
	registry.Register(contracts.RequestGetChannelsStatus, func(ctx context.Context, params any) (any, error) {
		var input contracts.ChannelsStatusParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		type backendChannel struct {
			Platform        contracts.Platform `json:"platform"`
			ChannelLogin    string             `json:"channelLogin"`
			ChannelID       string             `json:"channelId,omitempty"`
			UserAccessToken string             `json:"userAccessToken,omitempty"`
		}
		channels := make([]backendChannel, 0, len(input.Channels))
		for _, channel := range input.Channels {
			if channel.Platform != contracts.PlatformTwitch && channel.Platform != contracts.PlatformKick {
				return nil, fmt.Errorf("get channel statuses: unsupported platform %q", channel.Platform)
			}
			entry := backendChannel{
				Platform:     channel.Platform,
				ChannelLogin: channel.ChannelLogin,
				ChannelID:    channel.ChannelID,
			}
			account, err := store.FindAccountByPlatform(ctx, channel.Platform)
			if err != nil {
				return nil, fmt.Errorf("get channel statuses: find %s account: %w", channel.Platform, err)
			}
			if account != nil {
				tokens, found, err := store.AccountTokens(ctx, account.ID)
				if err != nil {
					return nil, fmt.Errorf("get channel statuses: read %s token: %w", channel.Platform, err)
				}
				if found {
					entry.UserAccessToken = tokens.AccessToken
				}
			}
			channels = append(channels, entry)
		}
		var response contracts.ChannelsStatusResponse
		if err := client.PostJSON(ctx, "/api/channels-status", struct {
			Channels []backendChannel `json:"channels"`
		}{Channels: channels}, &response); err != nil {
			return nil, fmt.Errorf("get channel statuses: %w", err)
		}
		return response, nil
	})
}
