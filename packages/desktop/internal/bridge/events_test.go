package bridge

import (
	"context"
	"errors"
	"testing"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/wailsapp/wails/v3/pkg/application"
)

var _ application.ServiceStartup = (*DesktopService)(nil)

type recordedEvent struct {
	name    string
	payload any
}

type recordingEmitter struct {
	events []recordedEvent
}

func (e *recordingEmitter) Emit(name string, payload any) bool {
	e.events = append(e.events, recordedEvent{name: name, payload: payload})
	return true
}

func TestDesktopServiceEmitsHistoricalEventNames(t *testing.T) {
	emitter := &recordingEmitter{}
	publisher := NewEventPublisher(emitter)

	publisher.EmitChatMessage(contracts.NormalizedChatMessage{ID: "message-1"})
	publisher.EmitChatEvent(contracts.NormalizedEvent{ID: "event-1"})
	publisher.EmitPlatformStatus(contracts.PlatformStatusInfo{Platform: contracts.PlatformTwitch})
	publisher.EmitAuthURL(contracts.AuthURL{Platform: contracts.PlatformTwitch, URL: "https://example.com"})
	publisher.EmitAuthSuccess(contracts.AuthSuccess{Platform: contracts.PlatformTwitch})
	publisher.EmitAuthError(contracts.AuthError{Platform: contracts.PlatformTwitch, Error: "denied"})
	publisher.EmitChannelEmotesSet(contracts.ChannelEmotesSet{Platform: contracts.PlatformTwitch})
	publisher.EmitChannelEmoteAdded(contracts.ChannelEmoteAdded{Platform: contracts.PlatformTwitch})
	publisher.EmitChannelEmoteRemoved(contracts.ChannelEmoteRemoved{Platform: contracts.PlatformTwitch})
	publisher.EmitChannelEmoteUpdated(contracts.ChannelEmoteUpdated{Platform: contracts.PlatformTwitch})
	publisher.EmitWatchedChannelMessage(contracts.WatchedChannelMessage{ChannelID: "watched-1"})
	publisher.EmitWatchedChannelStatus(contracts.WatchedChannelStatus{ChannelID: "watched-1"})
	publisher.EmitChatModeration(contracts.ModerationOutcome{Action: "delete_message"})

	want := []string{
		"chat_message",
		"chat_event",
		"platform_status",
		"auth_url",
		"auth_success",
		"auth_error",
		"channel_emotes_set",
		"channel_emote_added",
		"channel_emote_removed",
		"channel_emote_updated",
		"watched_channel_message",
		"watched_channel_status",
		"chat_moderation",
	}
	if len(emitter.events) != len(want) {
		t.Fatalf("event count = %d, want %d", len(emitter.events), len(want))
	}
	for index, event := range emitter.events {
		if event.name != want[index] {
			t.Errorf("event %d name = %q, want %q", index, event.name, want[index])
		}
	}
}

func TestDesktopServiceDispatchesRegisteredHandlers(t *testing.T) {
	registry := NewHandlerRegistry()
	service := NewDesktopService(registry)
	registry.Register(contracts.RequestGetAccounts, func(ctx context.Context, params any) (any, error) {
		if ctx == nil {
			t.Fatal("handler context is nil")
		}
		if params != nil {
			t.Errorf("params = %#v, want nil", params)
		}
		return []contracts.Account{{ID: "account-1"}}, nil
	})

	result, err := service.Call(contracts.GatewayRequest{Method: contracts.RequestGetAccounts})
	if err != nil {
		t.Fatalf("Call() error = %v", err)
	}
	accounts, ok := result.([]contracts.Account)
	if !ok || len(accounts) != 1 || accounts[0].ID != "account-1" {
		t.Errorf("Call() result = %#v, want account-1", result)
	}
}

func TestDesktopServiceRejectsUnregisteredRequestsPrecisely(t *testing.T) {
	service := NewDesktopService(NewHandlerRegistry())

	_, err := service.Call(contracts.GatewayRequest{Method: contracts.RequestGetSettings})
	if !errors.Is(err, ErrRequestUnavailable) {
		t.Fatalf("Call() error = %v, want ErrRequestUnavailable", err)
	}
	if got, want := err.Error(), `desktop request "getSettings" is unavailable: service has not been ported`; got != want {
		t.Errorf("Call() error = %q, want %q", got, want)
	}
}

func TestDesktopServiceReportsUpdatesDisabled(t *testing.T) {
	service := NewDesktopService(NewHandlerRegistry())

	if got, want := service.Capabilities(), (contracts.ApplicationCapabilities{Updates: false}); got != want {
		t.Errorf("Capabilities() = %#v, want %#v", got, want)
	}
}
