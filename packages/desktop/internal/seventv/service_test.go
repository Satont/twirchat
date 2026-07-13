package seventv

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

func TestServiceEnrichesOnlyExactAliasFromTheMessageChannel(t *testing.T) {
	service, err := NewService(Config{BackendURL: "http://backend.test", ClientSecret: "secret"})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	ctx := context.Background()
	service.Subscribe(ctx, Subscription{
		Platform:           contracts.PlatformKick,
		ChannelID:          "first-channel",
		CanonicalChannelID: "100",
	})
	service.Subscribe(ctx, Subscription{
		Platform:           contracts.PlatformKick,
		ChannelID:          "second-channel",
		CanonicalChannelID: "200",
	})

	service.handleBackendMessage(emoteSetMessage(t, contracts.PlatformKick, "100", []contracts.SevenTVEmote{{
		ID: "first-emote", Alias: "чё", Name: "чё", AspectRatio: 1, ImageURL: "https://cdn.test/first.webp",
	}}))
	service.handleBackendMessage(emoteSetMessage(t, contracts.PlatformKick, "200", []contracts.SevenTVEmote{{
		ID: "second-emote", Alias: "чё", Name: "чё", AspectRatio: 1, ImageURL: "https://cdn.test/second.webp",
	}}))

	message := service.Enrich(contracts.NormalizedChatMessage{
		ID: "message-1", Platform: contracts.PlatformKick, ChannelID: "first-channel", Text: "чё Чё",
		Timestamp: time.Now(), Type: "message",
	})
	if got, want := message.Emotes, []contracts.Emote{{
		ID: "first-emote", Name: "чё", ImageURL: "http://backend.test/proxy/7tv/first-emote?size=4x",
		Positions: []contracts.EmotePosition{{Start: 0, End: 1}},
	}}; !sameEmotes(got, want) {
		t.Fatalf("Enrich() emotes = %#v, want %#v", got, want)
	}
}

func TestServiceUsesTheBackendProxyForSevenTVImages(t *testing.T) {
	service, err := NewService(Config{BackendURL: "https://backend.test/api", ClientSecret: "secret"})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	service.Subscribe(context.Background(), Subscription{
		Platform: contracts.PlatformKick, ChannelID: "channel", CanonicalChannelID: "700",
	})
	service.handleBackendMessage(emoteSetMessage(t, contracts.PlatformKick, "700", []contracts.SevenTVEmote{{
		ID: "emote-1", Alias: "Wave", Name: "Wave", AspectRatio: 1, ImageURL: "https://cdn.7tv.app/emote/emote-1/4x.webp",
	}}))

	message := service.Enrich(contracts.NormalizedChatMessage{
		ID: "message-1", Platform: contracts.PlatformKick, ChannelID: "channel", Text: "Wave",
	})
	if got, want := message.Emotes[0].ImageURL, "https://backend.test/proxy/7tv/emote-1?size=4x"; got != want {
		t.Fatalf("7TV image URL = %q, want %q", got, want)
	}
}

func TestServiceConnectsToTheBackendWebSocketEndpoint(t *testing.T) {
	socket := &recordingSocket{}
	var socketConfig backend.WSConfig
	service, err := NewService(Config{
		BackendURL:   "https://backend.test/api",
		ClientSecret: "secret",
		SocketFactory: func(config backend.WSConfig) (Socket, error) {
			socketConfig = config
			return socket, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	service.Subscribe(context.Background(), Subscription{
		Platform: contracts.PlatformKick, ChannelID: "kick-one", CanonicalChannelID: "101",
	})
	service.Subscribe(context.Background(), Subscription{
		Platform: contracts.PlatformTwitch, ChannelID: "twitch-two", CanonicalChannelID: "twitch-two",
		PlatformUserID: "202",
	})
	socket.start = func(ctx context.Context) { socketConfig.OnConnected(ctx) }

	if err := service.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() { _ = service.Stop(context.Background()) })

	if got, want := socketConfig.URL, "wss://backend.test/ws"; got != want {
		t.Fatalf("backend WebSocket URL = %q, want %q", got, want)
	}
	if got, want := socket.sent, []any{map[string]any{
		"type": "seventv_resubscribe",
		"subscriptions": []map[string]any{
			{"platform": "kick", "channelId": "101"},
			{"platform": "twitch", "channelId": "twitch-two", "platformUserId": "202"},
		},
	}}; !sameWireMessages(got, want) {
		t.Fatalf("backend messages = %#v, want %#v", got, want)
	}
}

func TestServicePublishesLiveEmoteSetToItsDisplayChannel(t *testing.T) {
	events := &recordingEmoteEvents{}
	service, err := NewService(Config{
		BackendURL: "http://backend.test", ClientSecret: "secret", Events: events,
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	service.Subscribe(context.Background(), Subscription{
		Platform: contracts.PlatformKick, ChannelID: "display-channel", CanonicalChannelID: "700",
	})
	emotes := []contracts.SevenTVEmote{{
		ID: "emote-1", Alias: "чё", Name: "чё", AspectRatio: 1, ImageURL: "https://cdn.test/emote.webp",
	}}
	service.handleBackendMessage(emoteSetMessage(t, contracts.PlatformKick, "700", emotes))
	emotes[0].ImageURL = "http://backend.test/proxy/7tv/emote-1?size=4x"

	if got, want := events.sets, []contracts.ChannelEmotesSet{{
		Platform: contracts.PlatformKick, ChannelID: "display-channel", Emotes: emotes,
	}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("emote set events = %#v, want %#v", got, want)
	}
}

func TestServiceRoutesSystemMessageToEachDisplayChannel(t *testing.T) {
	messages := &recordingMessages{}
	service, err := NewService(Config{
		BackendURL: "http://backend.test", ClientSecret: "secret", Messages: messages,
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	service.Subscribe(context.Background(), Subscription{
		Platform: contracts.PlatformKick, ChannelID: "watched-channel", CanonicalChannelID: "700",
	})
	payload, err := json.Marshal(map[string]any{
		"type": "seventv_system_message", "platform": "kick", "channelId": "700", "action": "added",
		"emote": map[string]any{
			"id": "emote-1", "alias": "чё", "name": "чё", "aspectRatio": 1, "imageUrl": "https://cdn.test/emote.webp",
		},
	})
	if err != nil {
		t.Fatalf("marshal system message: %v", err)
	}
	service.handleBackendMessage(backend.Message{Type: "seventv_system_message", Data: payload})

	if got, want := len(messages.messages), 1; got != want {
		t.Fatalf("system messages = %#v, want one", messages.messages)
	}
	message := messages.messages[0]
	if message.ChannelID != "watched-channel" || message.Type != "system" || message.Platform != contracts.PlatformKick {
		t.Fatalf("system message = %#v", message)
	}
	if message.Text != "Emote :чё: added to the channel" || len(message.Emotes) != 1 ||
		message.Emotes[0].Positions[0] != (contracts.EmotePosition{Start: 6, End: 9}) {
		t.Fatalf("system message body = %#v", message)
	}
}

func TestServiceUnsubscribesCanonicalChannelAfterItsLastDisplayLookupIsRemoved(t *testing.T) {
	socket := &recordingSocket{}
	var socketConfig backend.WSConfig
	service, err := NewService(Config{
		BackendURL: "http://backend.test", ClientSecret: "secret",
		SocketFactory: func(config backend.WSConfig) (Socket, error) {
			socketConfig = config
			return socket, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	service.Subscribe(context.Background(), Subscription{
		Platform: contracts.PlatformKick, ChannelID: "channel-a", CanonicalChannelID: "700",
	})
	service.Subscribe(context.Background(), Subscription{
		Platform: contracts.PlatformKick, ChannelID: "channel-b", CanonicalChannelID: "700",
	})
	socket.start = func(ctx context.Context) { socketConfig.OnConnected(ctx) }
	if err := service.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() { _ = service.Stop(context.Background()) })
	socket.sent = nil

	service.Unsubscribe(context.Background(), contracts.PlatformKick, "channel-a")
	if got := len(socket.sent); got != 0 {
		t.Fatalf("messages after first unsubscribe = %#v, want none", socket.sent)
	}
	service.Unsubscribe(context.Background(), contracts.PlatformKick, "channel-b")
	if got, want := socket.sent, []any{map[string]any{
		"type": "seventv_unsubscribe", "platform": "kick", "channelId": "700",
	}}; !sameWireMessages(got, want) {
		t.Fatalf("messages after last unsubscribe = %#v, want %#v", got, want)
	}
}

func TestServiceTreatsUnicodeWhitespaceAsAnEmoteBoundary(t *testing.T) {
	service, err := NewService(Config{BackendURL: "http://backend.test", ClientSecret: "secret"})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	service.Subscribe(context.Background(), Subscription{
		Platform: contracts.PlatformTwitch, ChannelID: "streamer", CanonicalChannelID: "streamer",
	})
	service.handleBackendMessage(emoteSetMessage(t, contracts.PlatformTwitch, "streamer", []contracts.SevenTVEmote{{
		ID: "emote-1", Alias: "чё", Name: "чё", AspectRatio: 1, ImageURL: "https://cdn.test/emote.webp",
	}}))

	message := service.Enrich(contracts.NormalizedChatMessage{
		ID: "message-unicode-space", Platform: contracts.PlatformTwitch, ChannelID: "streamer", Text: "чё\u00a0чё",
	})
	if got, want := len(message.Emotes), 1; got != want {
		t.Fatalf("emote count = %d, want %d", got, want)
	}
	if got, want := message.Emotes[0].Positions, []contracts.EmotePosition{{Start: 0, End: 1}, {Start: 3, End: 4}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("emote positions = %#v, want %#v", got, want)
	}
}

func TestServiceProjectsEachLiveCatalogMutationToTheDisplayChannel(t *testing.T) {
	events := &recordingEmoteEvents{}
	service, err := NewService(Config{
		BackendURL: "http://backend.test", ClientSecret: "secret", Events: events,
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	service.Subscribe(context.Background(), Subscription{
		Platform: contracts.PlatformKick, ChannelID: "display-channel", CanonicalChannelID: "700",
	})
	service.handleBackendMessage(emoteSetMessage(t, contracts.PlatformKick, "700", nil))

	for _, payload := range []struct {
		messageType string
		body        map[string]any
	}{
		{
			messageType: "seventv_emote_added",
			body: map[string]any{"platform": "kick", "channelId": "700", "emote": map[string]any{
				"id": "emote-1", "alias": "чё", "name": "чё", "aspectRatio": 1, "imageUrl": "https://cdn.test/emote.webp",
			}},
		},
		{
			messageType: "seventv_emote_updated",
			body:        map[string]any{"platform": "kick", "channelId": "700", "emoteId": "emote-1", "alias": "Чё"},
		},
		{
			messageType: "seventv_emote_removed",
			body:        map[string]any{"platform": "kick", "channelId": "700", "emoteId": "emote-1"},
		},
	} {
		data, err := json.Marshal(payload.body)
		if err != nil {
			t.Fatalf("marshal %s: %v", payload.messageType, err)
		}
		service.handleBackendMessage(backend.Message{Type: payload.messageType, Data: data})
	}

	if got, want := events.added, []contracts.ChannelEmoteAdded{{
		Platform: contracts.PlatformKick, ChannelID: "display-channel", Emote: contracts.SevenTVEmote{ID: "emote-1", Alias: "чё", Name: "чё", AspectRatio: 1, ImageURL: "http://backend.test/proxy/7tv/emote-1?size=4x"},
	}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("added events = %#v, want %#v", got, want)
	}
	if got, want := events.updated, []contracts.ChannelEmoteUpdated{{
		Platform: contracts.PlatformKick, ChannelID: "display-channel", EmoteID: "emote-1", NewAlias: "Чё",
	}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("updated events = %#v, want %#v", got, want)
	}
	if got, want := events.removed, []contracts.ChannelEmoteRemoved{{
		Platform: contracts.PlatformKick, ChannelID: "display-channel", EmoteID: "emote-1",
	}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("removed events = %#v, want %#v", got, want)
	}
}

func emoteSetMessage(
	t *testing.T,
	platform contracts.Platform,
	channelID string,
	emotes []contracts.SevenTVEmote,
) backend.Message {
	t.Helper()
	payload, err := json.Marshal(struct {
		Type      string                   `json:"type"`
		Platform  contracts.Platform       `json:"platform"`
		ChannelID string                   `json:"channelId"`
		Emotes    []contracts.SevenTVEmote `json:"emotes"`
	}{Type: "seventv_emote_set", Platform: platform, ChannelID: channelID, Emotes: emotes})
	if err != nil {
		t.Fatalf("marshal 7TV event: %v", err)
	}
	return backend.Message{Type: "seventv_emote_set", Data: payload}
}

func sameEmotes(left, right []contracts.Emote) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index].ID != right[index].ID || left[index].Name != right[index].Name ||
			left[index].ImageURL != right[index].ImageURL ||
			len(left[index].Positions) != len(right[index].Positions) {
			return false
		}
		for position := range left[index].Positions {
			if left[index].Positions[position] != right[index].Positions[position] {
				return false
			}
		}
	}
	return true
}

type recordingSocket struct {
	start func(context.Context)
	sent  []any
}

type recordingEmoteEvents struct {
	sets    []contracts.ChannelEmotesSet
	added   []contracts.ChannelEmoteAdded
	removed []contracts.ChannelEmoteRemoved
	updated []contracts.ChannelEmoteUpdated
}

type recordingMessages struct {
	messages []contracts.NormalizedChatMessage
}

func (r *recordingMessages) Message(message contracts.NormalizedChatMessage) {
	r.messages = append(r.messages, message)
}

func (e *recordingEmoteEvents) EmitChannelEmotesSet(payload contracts.ChannelEmotesSet) bool {
	e.sets = append(e.sets, payload)
	return true
}

func (e *recordingEmoteEvents) EmitChannelEmoteAdded(payload contracts.ChannelEmoteAdded) bool {
	e.added = append(e.added, payload)
	return true
}
func (e *recordingEmoteEvents) EmitChannelEmoteRemoved(payload contracts.ChannelEmoteRemoved) bool {
	e.removed = append(e.removed, payload)
	return true
}
func (e *recordingEmoteEvents) EmitChannelEmoteUpdated(payload contracts.ChannelEmoteUpdated) bool {
	e.updated = append(e.updated, payload)
	return true
}

func (s *recordingSocket) Start(ctx context.Context) error {
	if s.start != nil {
		s.start(ctx)
	}
	return nil
}

func (*recordingSocket) Stop(context.Context) error { return nil }

func (s *recordingSocket) Send(_ context.Context, message any) error {
	s.sent = append(s.sent, message)
	return nil
}

func sameWireMessages(left, right []any) bool {
	encode := func(values []any) []any {
		encoded := make([]any, 0, len(values))
		for _, value := range values {
			data, err := json.Marshal(value)
			if err != nil {
				return nil
			}
			var decoded any
			if err := json.Unmarshal(data, &decoded); err != nil {
				return nil
			}
			encoded = append(encoded, decoded)
		}
		return encoded
	}
	return reflect.DeepEqual(encode(left), encode(right))
}
