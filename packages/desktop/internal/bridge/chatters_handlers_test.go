package bridge

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

type stubChattersProvider struct {
	result      contracts.ChannelChatters
	err         error
	channelSlug string
}

func (p *stubChattersProvider) Chatters(_ context.Context, channelSlug string) (contracts.ChannelChatters, error) {
	p.channelSlug = channelSlug
	return p.result, p.err
}

func TestRegisterChattersHandlersReturnsMixedTargetResults(t *testing.T) {
	twitchProvider := &stubChattersProvider{result: contracts.ChannelChatters{
		Platform:    contracts.PlatformTwitch,
		ChannelSlug: "streamer",
		Total:       1,
		Groups:      []contracts.ChatterGroup{{Role: contracts.ChatterRoleChatters}},
	}}
	registry := NewHandlerRegistry()
	RegisterChattersHandlers(registry, map[contracts.Platform]ChattersProvider{
		contracts.PlatformTwitch: twitchProvider,
	})

	result, err := NewDesktopService(registry).Call(contracts.GatewayRequest{
		Method: contracts.RequestGetChatters,
		Params: contracts.ChattersParams{Targets: []contracts.ChattersTarget{
			{Platform: contracts.PlatformTwitch, ChannelSlug: "streamer"},
			{Platform: contracts.PlatformYouTube, ChannelSlug: "video-channel"},
		}},
	})
	if err != nil {
		t.Fatalf("getChatters error = %v", err)
	}

	response, ok := result.(contracts.ChattersResponse)
	if !ok {
		t.Fatalf("result type = %T, want contracts.ChattersResponse", result)
	}
	if len(response.Results) != 2 {
		t.Fatalf("results length = %d, want 2", len(response.Results))
	}
	if !reflect.DeepEqual(response.Results[0], contracts.ChannelChatters{
		Platform:    contracts.PlatformTwitch,
		ChannelSlug: "streamer",
		Total:       1,
		Groups:      []contracts.ChatterGroup{{Role: contracts.ChatterRoleChatters}},
	}) {
		t.Fatalf("success result = %#v", response.Results[0])
	}
	if response.Results[1].Platform != contracts.PlatformYouTube || response.Results[1].ChannelSlug != "video-channel" ||
		response.Results[1].Error == "" {
		t.Fatalf("unsupported result = %#v, want per-target error", response.Results[1])
	}
	if twitchProvider.channelSlug != "streamer" {
		t.Fatalf("provider channel slug = %q, want streamer", twitchProvider.channelSlug)
	}
}

func TestRegisterChattersHandlersCapturesProviderErrorPerTarget(t *testing.T) {
	providerErr := errors.New("provider unavailable")
	provider := &stubChattersProvider{err: providerErr}
	registry := NewHandlerRegistry()
	RegisterChattersHandlers(registry, map[contracts.Platform]ChattersProvider{
		contracts.PlatformKick: provider,
	})

	result, err := NewDesktopService(registry).Call(contracts.GatewayRequest{
		Method: contracts.RequestGetChatters,
		Params: contracts.ChattersParams{Targets: []contracts.ChattersTarget{
			{Platform: contracts.PlatformKick, ChannelSlug: "streamer"},
		}},
	})
	if err != nil {
		t.Fatalf("getChatters error = %v", err)
	}
	response := result.(contracts.ChattersResponse)
	if got := response.Results[0]; got.Platform != contracts.PlatformKick || got.ChannelSlug != "streamer" ||
		got.Error != providerErr.Error() || len(got.Groups) != 0 {
		t.Fatalf("provider error result = %#v", got)
	}
}

func TestRegisterChattersHandlersRejectsEmptyTargets(t *testing.T) {
	registry := NewHandlerRegistry()
	RegisterChattersHandlers(registry, nil)

	_, err := NewDesktopService(registry).Call(contracts.GatewayRequest{
		Method: contracts.RequestGetChatters,
		Params: contracts.ChattersParams{},
	})
	if err == nil {
		t.Fatal("getChatters(empty targets) error = nil, want whole-request error")
	}
}

func TestRegisterChattersHandlersRejectsMalformedParams(t *testing.T) {
	registry := NewHandlerRegistry()
	RegisterChattersHandlers(registry, nil)

	_, err := NewDesktopService(registry).Call(contracts.GatewayRequest{
		Method: contracts.RequestGetChatters,
		Params: "not-an-object",
	})
	if err == nil {
		t.Fatal("getChatters malformed params error = nil, want whole-request error")
	}
}

func TestRegisterChattersHandlersRejectsNullParams(t *testing.T) {
	registry := NewHandlerRegistry()
	RegisterChattersHandlers(registry, nil)

	_, err := NewDesktopService(registry).Call(contracts.GatewayRequest{
		Method: contracts.RequestGetChatters,
		Params: nil,
	})
	if err == nil {
		t.Fatal("getChatters(null params) error = nil, want whole-request error")
	}
}
