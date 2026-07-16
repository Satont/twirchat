package bridge

import (
	"reflect"
	"testing"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

func TestRegisterSevenTVHandlersReturnsChannelScopedEmotesToVue(t *testing.T) {
	runtime := &recordingSevenTVRuntime{emotes: []contracts.SevenTVEmote{{
		ID: "7tv-1", Alias: "чё", Name: "чё", ImageURL: "https://cdn.test/7tv.webp", AspectRatio: 1,
	}}}
	registry := NewHandlerRegistry()
	RegisterSevenTVHandlers(registry, runtime)
	service := NewDesktopService(registry)

	result, err := service.Call(contracts.GatewayRequest{
		Method: contracts.RequestGetChannelEmotes,
		Params: map[string]any{"platform": "kick", "channelId": "watched-channel"},
	})
	if err != nil {
		t.Fatalf("getChannelEmotes error = %v", err)
	}
	want := []contracts.EmoteCatalogEntry{{
		ID: "7tv-1", Alias: "чё", Name: "чё", ImageURL: "https://cdn.test/7tv.webp", AspectRatio: 1,
		Source: contracts.EmoteSourceSevenTV,
	}}
	if got := result; !reflect.DeepEqual(got, want) {
		t.Fatalf("getChannelEmotes = %#v, want %#v", got, want)
	}
	if got, want := runtime.platform, contracts.PlatformKick; got != want {
		t.Fatalf("runtime platform = %q, want %q", got, want)
	}
	if got, want := runtime.channelID, "watched-channel"; got != want {
		t.Fatalf("runtime channel ID = %q, want %q", got, want)
	}
}

type recordingSevenTVRuntime struct {
	emotes    []contracts.SevenTVEmote
	platform  contracts.Platform
	channelID string
}

func (r *recordingSevenTVRuntime) Emotes(platform contracts.Platform, channelID string) []contracts.SevenTVEmote {
	r.platform = platform
	r.channelID = channelID
	return r.emotes
}
