package bridge

import (
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	eventChatMessage           = "chat_message"
	eventChatEvent             = "chat_event"
	eventPlatformStatus        = "platform_status"
	eventAuthURL               = "auth_url"
	eventAuthSuccess           = "auth_success"
	eventAuthError             = "auth_error"
	eventChannelEmotesSet      = "channel_emotes_set"
	eventChannelEmoteAdded     = "channel_emote_added"
	eventChannelEmoteRemoved   = "channel_emote_removed"
	eventChannelEmoteUpdated   = "channel_emote_updated"
	eventWatchedChannelMessage = "watched_channel_message"
	eventWatchedChannelStatus  = "watched_channel_status"
	eventUpdateStatus          = "update_status"
)

// EventEmitter is a narrow Wails event seam for bridge unit tests.
type EventEmitter interface {
	Emit(name string, payload any) bool
}

// WailsEventEmitter delivers bridge events through Wails' application event manager.
type WailsEventEmitter struct{}

func (WailsEventEmitter) Emit(name string, payload any) bool {
	app := application.Get()
	return app != nil && app.Event.Emit(name, payload)
}

// EventPublisher supplies the historical event contract to later service ports
// without exposing event helpers as Wails request methods.
type EventPublisher struct {
	events EventEmitter
}

// TwitchEvents adapts the live Twitch IRC service to the historical Vue event
// names without coupling the platform package to Wails.
type TwitchEvents struct{ publisher *EventPublisher }

func NewTwitchEvents(publisher *EventPublisher) TwitchEvents {
	return TwitchEvents{publisher: publisher}
}

func (e TwitchEvents) Message(message contracts.NormalizedChatMessage) {
	e.publisher.EmitChatMessage(message)
}

func (e TwitchEvents) Status(status contracts.PlatformStatusInfo) {
	e.publisher.EmitPlatformStatus(status)
}

func NewEventPublisher(events EventEmitter) *EventPublisher {
	return &EventPublisher{events: events}
}

func (p *EventPublisher) EmitChatMessage(payload contracts.NormalizedChatMessage) bool {
	return p.events.Emit(eventChatMessage, payload)
}

func (p *EventPublisher) EmitChatEvent(payload contracts.NormalizedEvent) bool {
	return p.events.Emit(eventChatEvent, payload)
}

func (p *EventPublisher) EmitPlatformStatus(payload contracts.PlatformStatusInfo) bool {
	return p.events.Emit(eventPlatformStatus, payload)
}

func (p *EventPublisher) EmitAuthURL(payload contracts.AuthURL) bool {
	return p.events.Emit(eventAuthURL, payload)
}

func (p *EventPublisher) EmitAuthSuccess(payload contracts.AuthSuccess) bool {
	return p.events.Emit(eventAuthSuccess, payload)
}

func (p *EventPublisher) EmitAuthError(payload contracts.AuthError) bool {
	return p.events.Emit(eventAuthError, payload)
}

func (p *EventPublisher) EmitChannelEmotesSet(payload contracts.ChannelEmotesSet) bool {
	return p.events.Emit(eventChannelEmotesSet, payload)
}

func (p *EventPublisher) EmitChannelEmoteAdded(payload contracts.ChannelEmoteAdded) bool {
	return p.events.Emit(eventChannelEmoteAdded, payload)
}

func (p *EventPublisher) EmitChannelEmoteRemoved(payload contracts.ChannelEmoteRemoved) bool {
	return p.events.Emit(eventChannelEmoteRemoved, payload)
}

func (p *EventPublisher) EmitChannelEmoteUpdated(payload contracts.ChannelEmoteUpdated) bool {
	return p.events.Emit(eventChannelEmoteUpdated, payload)
}

func (p *EventPublisher) EmitWatchedChannelMessage(payload contracts.WatchedChannelMessage) bool {
	return p.events.Emit(eventWatchedChannelMessage, payload)
}

func (p *EventPublisher) EmitWatchedChannelStatus(payload contracts.WatchedChannelStatus) bool {
	return p.events.Emit(eventWatchedChannelStatus, payload)
}

func (p *EventPublisher) EmitUpdateStatus(status, message string, progress *uint) bool {
	payload := map[string]any{"status": status, "message": message}
	if progress != nil {
		payload["progress"] = *progress
	}
	return p.events.Emit(eventUpdateStatus, payload)
}
