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
func RegisterTwitchHandlers(registry *HandlerRegistry, chat TwitchChat) {
	registry.Register(contracts.RequestGetStatuses, func(context.Context, any) (any, error) {
		return chat.Statuses(), nil
	})
	registry.Register(contracts.RequestJoinChannel, func(ctx context.Context, params any) (any, error) {
		var input contracts.ChannelParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		if input.Platform != contracts.PlatformTwitch {
			return nil, unsupportedTwitchPlatform(input.Platform)
		}
		return nil, chat.Join(ctx, input.ChannelSlug)
	})
	registry.Register(contracts.RequestLeaveChannel, func(ctx context.Context, params any) (any, error) {
		var input contracts.ChannelParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		if input.Platform != contracts.PlatformTwitch {
			return nil, unsupportedTwitchPlatform(input.Platform)
		}
		return nil, chat.Leave(ctx, input.ChannelSlug)
	})
	registry.Register(contracts.RequestSendMessage, func(ctx context.Context, params any) (any, error) {
		var input contracts.SendMessageParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		if input.Platform != contracts.PlatformTwitch {
			return nil, unsupportedTwitchPlatform(input.Platform)
		}
		return nil, chat.Send(ctx, input.ChannelID, input.Text, input.ReplyToMessageID)
	})
}

func unsupportedTwitchPlatform(platform contracts.Platform) error {
	return fmt.Errorf("Twitch chat handler does not support platform %q", platform)
}
