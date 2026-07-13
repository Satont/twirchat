package bridge

import (
	"context"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

// WatchedChannelsRuntime owns the live platform transports for persisted
// watched-channel tabs. It is deliberately small so bridge tests do not need
// Twitch, Kick, or Wails dependencies.
type WatchedChannelsRuntime interface {
	Add(context.Context, contracts.Platform, string) (contracts.WatchedChannel, error)
	Remove(context.Context, string) error
	Send(context.Context, string, string, string) error
	Messages(context.Context, string) ([]contracts.NormalizedChatMessage, error)
	Statuses() []contracts.WatchedChannelStatus
}

// RegisterWatchedChannelHandlers replaces the storage-only watched handlers
// with lifecycle-aware operations after the runtime manager is constructed.
func RegisterWatchedChannelHandlers(registry *HandlerRegistry, runtime WatchedChannelsRuntime) {
	registry.Register(contracts.RequestAddWatchedChannel, func(ctx context.Context, params any) (any, error) {
		var input contracts.AddWatchedChannelParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		return runtime.Add(ctx, input.Platform, input.ChannelSlug)
	})
	registry.Register(contracts.RequestRemoveWatchedChannel, func(ctx context.Context, params any) (any, error) {
		var input contracts.WatchedChannelIDParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		return nil, runtime.Remove(ctx, input.ID)
	})
	registry.Register(contracts.RequestSendWatchedChannelMessage, func(ctx context.Context, params any) (any, error) {
		var input contracts.SendWatchedChannelMessageParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		return nil, runtime.Send(ctx, input.ID, input.Text, input.ReplyToMessageID)
	})
	registry.Register(contracts.RequestGetWatchedChannelMessages, func(ctx context.Context, params any) (any, error) {
		var input contracts.WatchedChannelIDParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		return runtime.Messages(ctx, input.ID)
	})
	registry.Register(contracts.RequestGetWatchedChannelStatuses, func(context.Context, any) (any, error) {
		return runtime.Statuses(), nil
	})
}
