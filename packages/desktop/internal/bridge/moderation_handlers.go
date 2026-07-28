package bridge

import (
	"context"
	"errors"
	"fmt"

	"github.com/Satont/twirchat/packages/desktop/internal/auth"
	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

type moderationRequestBody struct {
	Platform        contracts.Platform         `json:"platform"`
	ChannelSlug     string                     `json:"channelSlug"`
	MessageID       string                     `json:"messageId,omitempty"`
	TargetUserID    string                     `json:"targetUserId,omitempty"`
	Action          contracts.ModerationAction `json:"action,omitempty"`
	DurationSeconds *int                       `json:"durationSeconds,omitempty"`
	AccessToken     string                     `json:"accessToken"`
	PlatformUserID  string                     `json:"platformUserId"`
	Scopes          []string                   `json:"scopes"`
}

// RegisterModerationHandlers keeps account tokens in the Go process while
// forwarding the selected rail action to the authenticated backend route.
func RegisterModerationHandlers(
	registry *HandlerRegistry,
	client *backend.HTTPClient,
	store *storage.Storage,
	refresher auth.TokenRefresher,
) {
	registry.Register(contracts.RequestGetModerationCapabilities, func(ctx context.Context, params any) (any, error) {
		var input contracts.ModerationCapabilitiesParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		body, err := moderationBody(ctx, store, refresher, input.Platform, input.ChannelSlug)
		if err != nil {
			return nil, err
		}
		var response contracts.ModerationCapabilities
		if err := client.PostJSON(ctx, "/api/moderation/capabilities", body, &response); err != nil {
			return nil, fmt.Errorf("get moderation capabilities: %w", err)
		}
		return response, nil
	})
	registry.Register(contracts.RequestModerateMessage, func(ctx context.Context, params any) (any, error) {
		var input contracts.ModerateMessageParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		body, err := moderationBody(ctx, store, refresher, input.Platform, input.ChannelSlug)
		if err != nil {
			return nil, err
		}
		body.MessageID = input.MessageID
		body.TargetUserID = input.TargetUserID
		body.Action = input.Action
		body.DurationSeconds = input.DurationSeconds
		var response contracts.ModerationActionResult
		if err := client.PostJSON(ctx, "/api/moderation/action", body, &response); err != nil {
			return nil, fmt.Errorf("moderate message: %w", err)
		}
		if !response.Success {
			if response.Error != nil && response.Error.Message != "" {
				return nil, errors.New(response.Error.Message)
			}
			return nil, errors.New("moderation action was rejected")
		}
		return response, nil
	})
}

func moderationBody(
	ctx context.Context,
	store *storage.Storage,
	refresher auth.TokenRefresher,
	platform contracts.Platform,
	channelSlug string,
) (moderationRequestBody, error) {
	if platform != contracts.PlatformTwitch && platform != contracts.PlatformKick {
		return moderationRequestBody{}, fmt.Errorf("moderation: unsupported platform %q", platform)
	}
	if channelSlug == "" {
		return moderationRequestBody{}, errors.New("moderation: channel slug is required")
	}
	account, err := store.FindAccountByPlatform(ctx, platform)
	if err != nil {
		return moderationRequestBody{}, fmt.Errorf("moderation: find %s account: %w", platform, err)
	}
	if account == nil {
		return moderationRequestBody{}, fmt.Errorf("moderation: authenticate with %s before moderating", platform)
	}
	tokens, found, err := auth.EnsureFreshTokens(ctx, store, refresher, account.ID)
	if err != nil {
		return moderationRequestBody{}, fmt.Errorf("moderation: read %s credentials: %w", platform, err)
	}
	if !found {
		return moderationRequestBody{}, fmt.Errorf("moderation: %s credentials are unavailable", platform)
	}
	return moderationRequestBody{
		Platform: platform, ChannelSlug: channelSlug, AccessToken: tokens.AccessToken,
		PlatformUserID: account.PlatformUserID, Scopes: account.Scopes,
	}, nil
}
