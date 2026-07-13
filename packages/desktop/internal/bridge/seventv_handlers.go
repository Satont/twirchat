package bridge

import (
	"context"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

// SevenTVRuntime supplies the native channel catalog to the restored Vue API.
type SevenTVRuntime interface {
	Emotes(contracts.Platform, string) []contracts.SevenTVEmote
}

// RegisterSevenTVHandlers replaces the empty bootstrap response once the live
// 7TV transport is running.
func RegisterSevenTVHandlers(registry *HandlerRegistry, runtime SevenTVRuntime) {
	registry.Register(contracts.RequestGetChannelEmotes, func(_ context.Context, params any) (any, error) {
		var input contracts.ChannelEmotesParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		return runtime.Emotes(input.Platform, input.ChannelID), nil
	})
}
