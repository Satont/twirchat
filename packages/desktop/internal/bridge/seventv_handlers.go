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
		emotes := runtime.Emotes(input.Platform, input.ChannelID)
		catalog := make([]contracts.EmoteCatalogEntry, 0, len(emotes))
		for _, emote := range emotes {
			catalog = append(catalog, catalogEntry(emote))
		}
		return catalog, nil
	})
}

func catalogEntry(emote contracts.SevenTVEmote) contracts.EmoteCatalogEntry {
	return contracts.EmoteCatalogEntry{
		ID:          emote.ID,
		Alias:       emote.Alias,
		Name:        emote.Name,
		ImageURL:    emote.ImageURL,
		Animated:    emote.Animated,
		ZeroWidth:   emote.ZeroWidth,
		AspectRatio: emote.AspectRatio,
		Source:      contracts.EmoteSourceSevenTV,
	}
}
