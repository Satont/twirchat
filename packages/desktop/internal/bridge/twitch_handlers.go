package bridge

import (
	"context"
	"fmt"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

// TwitchChat is implemented by the Twitch IRC lifecycle service.
type TwitchChat interface {
	Join(context.Context, string) error
	Leave(context.Context, string) error
	Send(context.Context, string, string, string) error
	Statuses() []contracts.PlatformStatusInfo
}

// RegisterTwitchHandlers attaches the live Twitch operations to the historical
// Vue request names. Kick will be added to the same platform dispatcher in its
// dedicated migration step.
func RegisterTwitchHandlers(registry *HandlerRegistry, chat TwitchChat, kick ...TwitchChat) {
	var kickChat TwitchChat
	if len(kick) > 0 {
		kickChat = kick[0]
	}
	registry.Register(contracts.RequestGetStatuses, func(context.Context, any) (any, error) {
		statuses := chat.Statuses()
		if kickChat != nil {
			statuses = append(statuses, kickChat.Statuses()...)
		}
		return statuses, nil
	})
	registry.Register(contracts.RequestJoinChannel, func(ctx context.Context, params any) (any, error) {
		var input contracts.ChannelParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		target, err := chatForPlatform(input.Platform, chat, kickChat)
		if err != nil {
			return nil, err
		}
		return nil, target.Join(ctx, input.ChannelSlug)
	})
	registry.Register(contracts.RequestLeaveChannel, func(ctx context.Context, params any) (any, error) {
		var input contracts.ChannelParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		target, err := chatForPlatform(input.Platform, chat, kickChat)
		if err != nil {
			return nil, err
		}
		return nil, target.Leave(ctx, input.ChannelSlug)
	})
	registry.Register(contracts.RequestSendMessage, func(ctx context.Context, params any) (any, error) {
		var input contracts.SendMessageParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		target, err := chatForPlatform(input.Platform, chat, kickChat)
		if err != nil {
			return nil, err
		}
		return nil, target.Send(ctx, input.ChannelID, input.Text, input.ReplyToMessageID)
	})
}

func chatForPlatform(platform contracts.Platform, twitchChat, kickChat TwitchChat) (TwitchChat, error) {
	switch platform {
	case contracts.PlatformTwitch:
		return twitchChat, nil
	case contracts.PlatformKick:
		if kickChat != nil {
			return kickChat, nil
		}
	}
	return nil, unsupportedTwitchPlatform(platform)
}

func unsupportedTwitchPlatform(platform contracts.Platform) error {
	return fmt.Errorf("Twitch chat handler does not support platform %q", platform)
}
