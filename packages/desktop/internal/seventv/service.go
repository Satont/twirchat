// Package seventv keeps native desktop 7TV subscriptions and emote catalogs.
package seventv

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"
	"unicode/utf16"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

// Config describes the backend identity used by the native 7TV transport.
type Config struct {
	BackendURL    string
	ClientSecret  string
	Events        EmoteEvents
	Messages      MessageSink
	SocketFactory SocketFactory
}

// EmoteEvents is the Wails-facing projection of live 7TV catalog mutations.
// bridge.EventPublisher implements this without coupling 7TV to Wails.
type EmoteEvents interface {
	EmitChannelEmotesSet(contracts.ChannelEmotesSet) bool
	EmitChannelEmoteAdded(contracts.ChannelEmoteAdded) bool
	EmitChannelEmoteRemoved(contracts.ChannelEmoteRemoved) bool
	EmitChannelEmoteUpdated(contracts.ChannelEmoteUpdated) bool
}

// MessageSink routes 7TV system rows through the same fan-out as platform chat.
// watched.Manager implements it, so watched tabs receive these notifications too.
type MessageSink interface {
	Message(contracts.NormalizedChatMessage)
}

// Socket is the narrow reconnecting backend transport required by 7TV.
type Socket interface {
	Start(context.Context) error
	Stop(context.Context) error
	Send(context.Context, any) error
}

// SocketFactory lets service tests exercise reconnect behavior without a real
// network connection while production uses backend.WSClient.
type SocketFactory func(backend.WSConfig) (Socket, error)

// Subscription identifies a displayed desktop channel and the canonical
// platform identity used by the backend's 7TV lookup.
type Subscription struct {
	Platform           contracts.Platform
	ChannelID          string
	CanonicalChannelID string
	PlatformUserID     string
}

// ChannelService is the narrow dependency used by native platform transports.
type ChannelService interface {
	Subscribe(context.Context, Subscription)
	Unsubscribe(context.Context, contracts.Platform, string)
	Enrich(contracts.NormalizedChatMessage) contracts.NormalizedChatMessage
}

type catalog struct {
	emotes map[string]contracts.SevenTVEmote
}

type backendPayload struct {
	Platform  contracts.Platform       `json:"platform"`
	ChannelID string                   `json:"channelId"`
	Emotes    []contracts.SevenTVEmote `json:"emotes"`
	Emote     contracts.SevenTVEmote   `json:"emote"`
	EmoteID   string                   `json:"emoteId"`
	Alias     string                   `json:"alias"`
	Action    string                   `json:"action"`
	OldAlias  string                   `json:"oldAlias"`
	SetName   string                   `json:"setName"`
	OldName   string                   `json:"oldName"`
	NewName   string                   `json:"newName"`
}

// Service keeps every catalog isolated by platform and canonical channel ID.
// Aliases are stored exactly as sent by 7TV; case-folding would incorrectly
// make aliases such as "чё" and "Чё" equivalent.
type Service struct {
	backendURL   string
	clientSecret string
	events       EmoteEvents
	messages     MessageSink

	mu                sync.RWMutex
	catalogs          map[string]catalog
	lookupToCanonical map[string]string
	subscriptions     map[string]Subscription
	displayIDs        map[string]map[string]struct{}
	socketFactory     SocketFactory
	socket            Socket
	started           bool
	connected         bool
	systemSequence    atomic.Uint64
}

func NewService(config Config) (*Service, error) {
	if strings.TrimSpace(config.BackendURL) == "" {
		return nil, errors.New("create 7TV service: backend URL is required")
	}
	if strings.TrimSpace(config.ClientSecret) == "" {
		return nil, errors.New("create 7TV service: client secret is required")
	}
	if config.SocketFactory == nil {
		config.SocketFactory = func(socketConfig backend.WSConfig) (Socket, error) {
			return backend.NewWSClient(socketConfig)
		}
	}
	return &Service{
		backendURL:        config.BackendURL,
		clientSecret:      config.ClientSecret,
		events:            config.Events,
		messages:          config.Messages,
		catalogs:          make(map[string]catalog),
		lookupToCanonical: make(map[string]string),
		subscriptions:     make(map[string]Subscription),
		displayIDs:        make(map[string]map[string]struct{}),
		socketFactory:     config.SocketFactory,
	}, nil
}

// Start opens the reconnecting backend socket. When a connection becomes
// available, the whole native subscription snapshot is sent atomically as the
// protocol's seventv_resubscribe command.
func (s *Service) Start(ctx context.Context) error {
	websocketURL, err := backendWebSocketURL(s.backendURL)
	if err != nil {
		return err
	}
	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return errors.New("start 7TV service: service already started")
	}
	s.started = true
	s.mu.Unlock()

	socket, err := s.socketFactory(backend.WSConfig{
		URL:          websocketURL,
		ClientSecret: s.clientSecret,
		OnConnected:  s.onConnected,
		OnMessage:    s.handleBackendMessage,
	})
	if err != nil {
		s.mu.Lock()
		s.started = false
		s.mu.Unlock()
		return fmt.Errorf("start 7TV service: create backend socket: %w", err)
	}
	s.mu.Lock()
	s.socket = socket
	s.mu.Unlock()
	if err := socket.Start(ctx); err != nil {
		s.mu.Lock()
		s.socket = nil
		s.started = false
		s.mu.Unlock()
		return fmt.Errorf("start 7TV service: %w", err)
	}
	return nil
}

// Stop disables live sends before stopping the socket's reconnect loop.
func (s *Service) Stop(ctx context.Context) error {
	s.mu.Lock()
	socket := s.socket
	s.socket = nil
	s.started = false
	s.connected = false
	s.mu.Unlock()
	if socket == nil {
		return nil
	}
	return socket.Stop(ctx)
}

// Subscribe remembers a channel before the WebSocket is connected. The live
// transport sends the accumulated subscriptions once it has connected.
func (s *Service) Subscribe(_ context.Context, subscription Subscription) {
	if subscription.Platform == "" || subscription.ChannelID == "" || subscription.CanonicalChannelID == "" {
		return
	}
	canonicalKey := channelKey(subscription.Platform, subscription.CanonicalChannelID)
	displayKey := channelKey(subscription.Platform, subscription.ChannelID)

	s.mu.Lock()
	s.subscriptions[canonicalKey] = subscription
	s.lookupToCanonical[displayKey] = canonicalKey
	s.lookupToCanonical[canonicalKey] = canonicalKey
	if s.displayIDs[canonicalKey] == nil {
		s.displayIDs[canonicalKey] = make(map[string]struct{})
	}
	s.displayIDs[canonicalKey][subscription.ChannelID] = struct{}{}
	socket := s.socket
	connected := s.connected
	s.mu.Unlock()
	if connected && socket != nil {
		_ = socket.Send(context.Background(), newSubscribeCommand(subscription))
	}
}

// Unsubscribe removes one displayed channel lookup. The backend subscription is
// released only after no displayed channels still refer to that canonical ID.
func (s *Service) Unsubscribe(_ context.Context, platform contracts.Platform, channelID string) {
	displayKey := channelKey(platform, channelID)
	s.mu.Lock()
	canonicalKey, found := s.lookupToCanonical[displayKey]
	if !found {
		s.mu.Unlock()
		return
	}
	delete(s.lookupToCanonical, displayKey)
	displays := s.displayIDs[canonicalKey]
	delete(displays, channelID)
	if len(displays) > 0 {
		s.mu.Unlock()
		return
	}
	delete(s.displayIDs, canonicalKey)
	delete(s.lookupToCanonical, canonicalKey)
	subscription := s.subscriptions[canonicalKey]
	delete(s.subscriptions, canonicalKey)
	delete(s.catalogs, canonicalKey)
	socket := s.socket
	connected := s.connected
	s.mu.Unlock()
	if connected && socket != nil {
		_ = socket.Send(context.Background(), unsubscribeCommand{
			Type: "seventv_unsubscribe", Platform: platform, ChannelID: subscription.CanonicalChannelID,
		})
	}
}

// Enrich resolves whitespace-delimited 7TV aliases for the exact channel and
// merges them with provider-native emotes without modifying provider ranges.
func (s *Service) Enrich(message contracts.NormalizedChatMessage) contracts.NormalizedChatMessage {
	s.mu.RLock()
	canonicalKey := s.resolveChannelKeyLocked(message.Platform, message.ChannelID)
	current, found := s.catalogs[canonicalKey]
	s.mu.RUnlock()
	if !found {
		return message
	}

	merged := make(map[string]*contracts.Emote)
	for _, emote := range message.Emotes {
		copy := emote
		copy.Positions = append([]contracts.EmotePosition(nil), emote.Positions...)
		merged[emote.ID] = &copy
	}
	for _, token := range messageTokens(message.Text) {
		emote, exists := current.emotes[token.text]
		if !exists {
			continue
		}
		position := contracts.EmotePosition{Start: token.start, End: token.end}
		if existing, exists := merged[emote.ID]; exists {
			existing.Positions = append(existing.Positions, position)
			continue
		}
		aspectRatio := emote.AspectRatio
		merged[emote.ID] = &contracts.Emote{
			ID:          emote.ID,
			Name:        emote.Alias,
			ImageURL:    emote.ImageURL,
			AspectRatio: &aspectRatio,
			Positions:   []contracts.EmotePosition{position},
		}
	}

	message.Emotes = make([]contracts.Emote, 0, len(merged))
	for _, emote := range merged {
		message.Emotes = append(message.Emotes, *emote)
	}
	sort.Slice(message.Emotes, func(left, right int) bool {
		return message.Emotes[left].ID < message.Emotes[right].ID
	})
	return message
}

// Emotes returns a stable snapshot for the requested display or canonical
// channel identity.
func (s *Service) Emotes(platform contracts.Platform, channelID string) []contracts.SevenTVEmote {
	s.mu.RLock()
	current, found := s.catalogs[s.resolveChannelKeyLocked(platform, channelID)]
	s.mu.RUnlock()
	if !found {
		return []contracts.SevenTVEmote{}
	}
	emotes := make([]contracts.SevenTVEmote, 0, len(current.emotes))
	for _, emote := range current.emotes {
		emotes = append(emotes, emote)
	}
	sort.Slice(emotes, func(left, right int) bool {
		return emotes[left].Alias < emotes[right].Alias
	})
	return emotes
}

func (s *Service) handleBackendMessage(message backend.Message) {
	if message.Type != "seventv_emote_set" && message.Type != "seventv_emote_added" &&
		message.Type != "seventv_emote_removed" && message.Type != "seventv_emote_updated" &&
		message.Type != "seventv_system_message" {
		return
	}
	var payload backendPayload
	if err := json.Unmarshal(message.Data, &payload); err != nil || payload.Platform == "" || payload.ChannelID == "" {
		return
	}
	payload.Emotes = s.proxiedEmotes(payload.Emotes)
	payload.Emote = s.proxiedEmote(payload.Emote)
	if message.Type == "seventv_system_message" {
		s.handleSystemMessage(payload)
		return
	}
	key := channelKey(payload.Platform, payload.ChannelID)
	s.mu.Lock()
	s.lookupToCanonical[key] = key
	current := s.catalogs[key]
	if current.emotes == nil {
		current.emotes = make(map[string]contracts.SevenTVEmote)
	}
	switch message.Type {
	case "seventv_emote_set":
		current.emotes = make(map[string]contracts.SevenTVEmote, len(payload.Emotes))
		for _, emote := range payload.Emotes {
			current.emotes[emote.Alias] = emote
		}
	case "seventv_emote_added":
		if payload.Emote.ID == "" || payload.Emote.Alias == "" {
			s.mu.Unlock()
			return
		}
		current.emotes[payload.Emote.Alias] = payload.Emote
	case "seventv_emote_removed":
		for alias, emote := range current.emotes {
			if emote.ID == payload.EmoteID {
				delete(current.emotes, alias)
			}
		}
	case "seventv_emote_updated":
		for alias, emote := range current.emotes {
			if emote.ID == payload.EmoteID {
				delete(current.emotes, alias)
				emote.Alias = payload.Alias
				current.emotes[payload.Alias] = emote
				break
			}
		}
	}
	s.catalogs[key] = current
	displayIDs := s.displayChannelIDsLocked(key)
	s.mu.Unlock()
	s.emitCatalogMutation(message.Type, payload, current, displayIDs)
}

func (s *Service) displayChannelIDsLocked(canonicalKey string) []string {
	ids := s.displayIDs[canonicalKey]
	if len(ids) == 0 {
		_, channelID, found := strings.Cut(canonicalKey, ":")
		if !found {
			return nil
		}
		return []string{channelID}
	}
	result := make([]string, 0, len(ids))
	for channelID := range ids {
		result = append(result, channelID)
	}
	sort.Strings(result)
	return result
}

func (s *Service) emitCatalogMutation(
	messageType string,
	payload backendPayload,
	current catalog,
	displayIDs []string,
) {
	if s.events == nil {
		return
	}
	for _, channelID := range displayIDs {
		switch messageType {
		case "seventv_emote_set":
			s.events.EmitChannelEmotesSet(contracts.ChannelEmotesSet{
				Platform: payload.Platform, ChannelID: channelID, Emotes: catalogEmotes(current),
			})
		case "seventv_emote_added":
			s.events.EmitChannelEmoteAdded(contracts.ChannelEmoteAdded{
				Platform: payload.Platform, ChannelID: channelID, Emote: payload.Emote,
			})
		case "seventv_emote_removed":
			s.events.EmitChannelEmoteRemoved(contracts.ChannelEmoteRemoved{
				Platform: payload.Platform, ChannelID: channelID, EmoteID: payload.EmoteID,
			})
		case "seventv_emote_updated":
			s.events.EmitChannelEmoteUpdated(contracts.ChannelEmoteUpdated{
				Platform: payload.Platform, ChannelID: channelID, EmoteID: payload.EmoteID, NewAlias: payload.Alias,
			})
		}
	}
}

func (s *Service) handleSystemMessage(payload backendPayload) {
	if s.messages == nil {
		return
	}
	key := channelKey(payload.Platform, payload.ChannelID)
	s.mu.RLock()
	displayIDs := s.displayChannelIDsLocked(key)
	s.mu.RUnlock()
	for _, channelID := range displayIDs {
		s.messages.Message(s.systemMessage(payload, channelID))
	}
}

func (s *Service) systemMessage(payload backendPayload, channelID string) contracts.NormalizedChatMessage {
	text, emotes := systemMessageContent(payload)
	return contracts.NormalizedChatMessage{
		ID:        fmt.Sprintf("7tv-system:%s:%s:%d", payload.Platform, channelID, s.systemSequence.Add(1)),
		Platform:  payload.Platform,
		ChannelID: channelID,
		Author: contracts.ChatAuthor{
			ID: "7tv-system", Username: "7TV", DisplayName: "7TV", Color: "#6441a5", Badges: []contracts.Badge{},
		},
		Text: text, Emotes: emotes, Timestamp: time.Now().UTC(), Type: "system",
	}
}

func systemMessageContent(payload backendPayload) (string, []contracts.Emote) {
	switch payload.Action {
	case "set_changed":
		return fmt.Sprintf("Active emote set changed to «%s»", payload.SetName), []contracts.Emote{}
	case "set_renamed":
		return fmt.Sprintf("Emote set «%s» renamed to «%s»", payload.OldName, payload.NewName), []contracts.Emote{}
	case "set_deleted":
		return fmt.Sprintf("Emote set «%s» was deleted", payload.SetName), []contracts.Emote{}
	}
	action := "renamed in"
	if payload.Action == "added" {
		action = "added to"
	} else if payload.Action == "removed" {
		action = "removed from"
	}
	emoteText := ":" + payload.Emote.Alias + ":"
	text := "Emote " + emoteText
	if payload.OldAlias != "" {
		text += " (was " + payload.OldAlias + ")"
	}
	text += " " + action + " the channel"
	aspectRatio := payload.Emote.AspectRatio
	return text, []contracts.Emote{{
		ID:          payload.Emote.ID,
		Name:        payload.Emote.Alias,
		ImageURL:    payload.Emote.ImageURL,
		AspectRatio: &aspectRatio,
		Positions: []contracts.EmotePosition{{
			Start: utf16CodeUnits("Emote "),
			End:   utf16CodeUnits("Emote "+emoteText) - 1,
		}},
	}}
}

func catalogEmotes(current catalog) []contracts.SevenTVEmote {
	emotes := make([]contracts.SevenTVEmote, 0, len(current.emotes))
	for _, emote := range current.emotes {
		emotes = append(emotes, emote)
	}
	sort.Slice(emotes, func(left, right int) bool {
		return emotes[left].Alias < emotes[right].Alias
	})
	return emotes
}

func (s *Service) resolveChannelKeyLocked(platform contracts.Platform, channelID string) string {
	key := channelKey(platform, channelID)
	if canonical, found := s.lookupToCanonical[key]; found {
		return canonical
	}
	return key
}

func channelKey(platform contracts.Platform, channelID string) string {
	return string(platform) + ":" + channelID
}

func (s *Service) onConnected(ctx context.Context) {
	s.mu.Lock()
	s.connected = true
	socket := s.socket
	subscriptions := s.subscriptionsSnapshotLocked()
	s.mu.Unlock()
	if socket == nil || len(subscriptions) == 0 {
		return
	}
	commands := make([]subscriptionPayload, 0, len(subscriptions))
	for _, subscription := range subscriptions {
		commands = append(commands, newSubscriptionPayload(subscription))
	}
	_ = socket.Send(ctx, resubscribeCommand{Type: "seventv_resubscribe", Subscriptions: commands})
}

func (s *Service) subscriptionsSnapshotLocked() []Subscription {
	keys := make([]string, 0, len(s.subscriptions))
	for key := range s.subscriptions {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	subscriptions := make([]Subscription, 0, len(keys))
	for _, key := range keys {
		subscriptions = append(subscriptions, s.subscriptions[key])
	}
	return subscriptions
}

type subscribeCommand struct {
	Type string `json:"type"`
	subscriptionPayload
}

func newSubscribeCommand(subscription Subscription) subscribeCommand {
	return subscribeCommand{
		Type:                "seventv_subscribe",
		subscriptionPayload: newSubscriptionPayload(subscription),
	}
}

type subscriptionPayload struct {
	Platform       contracts.Platform `json:"platform"`
	ChannelID      string             `json:"channelId"`
	PlatformUserID string             `json:"platformUserId,omitempty"`
}

func newSubscriptionPayload(subscription Subscription) subscriptionPayload {
	return subscriptionPayload{
		Platform:       subscription.Platform,
		ChannelID:      subscription.CanonicalChannelID,
		PlatformUserID: subscription.PlatformUserID,
	}
}

type resubscribeCommand struct {
	Type          string                `json:"type"`
	Subscriptions []subscriptionPayload `json:"subscriptions"`
}

type unsubscribeCommand struct {
	Type      string             `json:"type"`
	Platform  contracts.Platform `json:"platform"`
	ChannelID string             `json:"channelId"`
}

func backendWebSocketURL(rawURL string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("start 7TV service: invalid backend URL %q", rawURL)
	}
	switch parsed.Scheme {
	case "http":
		parsed.Scheme = "ws"
	case "https":
		parsed.Scheme = "wss"
	case "ws", "wss":
	default:
		return "", fmt.Errorf("start 7TV service: backend URL %q must use HTTP or WebSocket", rawURL)
	}
	parsed.Path = "/ws"
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func (s *Service) proxiedEmotes(emotes []contracts.SevenTVEmote) []contracts.SevenTVEmote {
	for index := range emotes {
		emotes[index] = s.proxiedEmote(emotes[index])
	}
	return emotes
}

func (s *Service) proxiedEmote(emote contracts.SevenTVEmote) contracts.SevenTVEmote {
	if emote.ID == "" {
		return emote
	}
	backendURL, err := url.Parse(s.backendURL)
	if err != nil || backendURL.Scheme == "" || backendURL.Host == "" {
		return emote
	}
	backendURL.Path = "/proxy/7tv/" + url.PathEscape(emote.ID)
	backendURL.RawPath = ""
	backendURL.RawQuery = "size=4x"
	backendURL.Fragment = ""
	emote.ImageURL = backendURL.String()
	return emote
}

type messageToken struct {
	text       string
	start, end int
}

func messageTokens(text string) []messageToken {
	tokens := make([]messageToken, 0)
	startByte := -1
	startPosition := 0
	position := 0
	for byteIndex, character := range text {
		if !isWhitespace(character) && startByte < 0 {
			startByte = byteIndex
			startPosition = position
		}
		if isWhitespace(character) && startByte >= 0 {
			token := text[startByte:byteIndex]
			tokens = append(tokens, messageToken{
				text: token, start: startPosition, end: startPosition + utf16CodeUnits(token) - 1,
			})
			startByte = -1
		}
		position += utf16CodeUnits(string(character))
	}
	if startByte >= 0 {
		token := text[startByte:]
		tokens = append(tokens, messageToken{
			text: token, start: startPosition, end: startPosition + utf16CodeUnits(token) - 1,
		})
	}
	return tokens
}

func isWhitespace(character rune) bool {
	return unicode.IsSpace(character)
}

func utf16CodeUnits(value string) int {
	return len(utf16.Encode([]rune(value)))
}
