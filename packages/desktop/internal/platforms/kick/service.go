package kick

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/Satont/twirchat/packages/desktop/internal/auth"
	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/seventv"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
	"github.com/coder/websocket"
)

const (
	defaultChatAPIURL        = "https://api.kick.com/public/v1/chat"
	defaultActiveChattersURL = "https://web.kick.com/api/v1/channels"
	pusherURL                = "wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=twirchat&version=1.0&flash=false"

	defaultReconnectInitial = 3 * time.Second
	defaultReconnectMaximum = 30 * time.Second
)

// ErrDeliveryRejected identifies a provider response that deliberately refused
// a chat message (for example follower-only mode). Callers can show its text
// directly instead of presenting an opaque HTTP status.
var ErrDeliveryRejected = errors.New("Kick rejected chat message")

type Events interface {
	Status(contracts.PlatformStatusInfo)
	Message(contracts.NormalizedChatMessage)
	Moderation(contracts.ModerationOutcome)
}
type Config struct {
	Storage           *storage.Storage
	Events            Events
	Backend           *backend.HTTPClient
	ChatAPIURL        string
	ActiveChattersURL string
	// Refresher renews expired OAuth credentials before sends and after a 401.
	// Optional: tests and anonymous-only setups may leave it nil.
	Refresher auth.TokenRefresher
	// PusherURL is a test hook, like ChatAPIURL — production uses the package default.
	PusherURL        string
	ReconnectInitial time.Duration
	ReconnectMaximum time.Duration
	SevenTV          seventv.ChannelService
}
type Service struct {
	storage           *storage.Storage
	events            Events
	backend           *backend.HTTPClient
	sevenTV           seventv.ChannelService
	chatAPIURL        string
	activeChattersURL string
	pusherURL         string
	client            *http.Client
	refresher         auth.TokenRefresher
	mu                sync.Mutex
	ctx               context.Context
	channels          map[string]int64
	chatrooms         map[string]int64
	connections       map[string]*websocket.Conn
	cancels           map[string]context.CancelFunc
	statuses          map[string]contracts.PlatformStatusInfo

	reconnectInitial time.Duration
	reconnectMaximum time.Duration
}

func NewService(config Config) (*Service, error) {
	if config.Storage == nil || config.Events == nil || config.Backend == nil {
		return nil, errors.New("create Kick service: storage, events, and backend are required")
	}
	if config.ChatAPIURL == "" {
		config.ChatAPIURL = defaultChatAPIURL
	}
	if config.ActiveChattersURL == "" {
		config.ActiveChattersURL = defaultActiveChattersURL
	}
	if config.PusherURL == "" {
		config.PusherURL = pusherURL
	}
	if config.ReconnectInitial <= 0 {
		config.ReconnectInitial = defaultReconnectInitial
	}
	if config.ReconnectMaximum <= 0 {
		config.ReconnectMaximum = defaultReconnectMaximum
	}
	if config.ReconnectMaximum < config.ReconnectInitial {
		config.ReconnectMaximum = config.ReconnectInitial
	}
	return &Service{
		storage: config.Storage, events: config.Events, backend: config.Backend, chatAPIURL: config.ChatAPIURL,
		activeChattersURL: config.ActiveChattersURL,
		pusherURL:         config.PusherURL, sevenTV: config.SevenTV, client: http.DefaultClient, refresher: config.Refresher,
		channels: map[string]int64{}, chatrooms: map[string]int64{}, connections: map[string]*websocket.Conn{},
		cancels: map[string]context.CancelFunc{}, statuses: map[string]contracts.PlatformStatusInfo{},
		reconnectInitial: config.ReconnectInitial, reconnectMaximum: config.ReconnectMaximum,
	}, nil
}
func (s *Service) Start(ctx context.Context) error {
	s.mu.Lock()
	s.ctx = ctx
	s.mu.Unlock()
	channels, err := s.storage.ChannelsByPlatform(ctx, contracts.PlatformKick)
	if err != nil {
		return err
	}
	slog.Info("start Kick chat service", "persisted_channels", len(channels))
	for _, channel := range channels {
		if err := s.connect(ctx, channel); err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) Stop(context.Context) error {
	s.mu.Lock()
	connections := s.connections
	s.connections = map[string]*websocket.Conn{}
	cancels := s.cancels
	s.cancels = map[string]context.CancelFunc{}
	s.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
	for _, connection := range connections {
		_ = connection.Close(websocket.StatusNormalClosure, "shutdown")
	}
	return nil
}
func (s *Service) Join(ctx context.Context, channel string) error {
	channel = normalize(channel)
	if channel == "" {
		return errors.New("join Kick channel: channel slug is required")
	}
	slog.Info("join Kick channel", "channel", channel)
	if err := s.storage.SaveChannel(ctx, contracts.PlatformKick, channel); err != nil {
		return err
	}
	return s.connect(ctx, channel)
}
func (s *Service) Leave(ctx context.Context, channel string) error {
	channel = normalize(channel)
	if channel == "" {
		return errors.New("leave Kick channel: channel slug is required")
	}
	slog.Info("leave Kick channel", "channel", channel)
	if err := s.storage.RemoveChannel(ctx, contracts.PlatformKick, channel); err != nil {
		return err
	}
	if s.sevenTV != nil {
		s.sevenTV.Unsubscribe(ctx, contracts.PlatformKick, channel)
	}
	s.mu.Lock()
	cancel := s.cancels[channel]
	delete(s.cancels, channel)
	connection := s.connections[channel]
	delete(s.connections, channel)
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if connection != nil {
		_ = connection.Close(websocket.StatusNormalClosure, "leave channel")
	}
	s.emit(channel, "disconnected", "")
	return nil
}
func (s *Service) Send(ctx context.Context, channel, text, _ string) error {
	channel = normalize(channel)
	if channel == "" {
		return errors.New("send Kick message: channel is required")
	}
	if strings.TrimSpace(text) == "" {
		return errors.New("send Kick message: text is required")
	}
	slog.Info("send Kick message", "channel", channel)
	account, err := s.storage.FindAccountByPlatform(ctx, contracts.PlatformKick)
	if err != nil {
		return err
	}
	if account == nil {
		return errors.New("send Kick message: authenticate with Kick before sending messages")
	}
	tokens, found, err := auth.EnsureFreshTokens(ctx, s.storage, s.refresher, account.ID)
	if err != nil {
		return err
	}
	if !found {
		return errors.New("send Kick message: credentials are unavailable")
	}
	broadcaster, found := s.cachedChannelID(channel)
	if !found {
		if err := s.connect(ctx, channel); err != nil {
			return err
		}
		broadcaster, found = s.cachedChannelID(channel)
		if !found {
			return errors.New("send Kick message: broadcaster ID is unavailable")
		}
	}
	status, body, err := s.postMessage(ctx, broadcaster, text, tokens.AccessToken)
	if err != nil {
		return err
	}
	if status == http.StatusUnauthorized && s.refreshAccount(ctx, account.ID) {
		tokens, found, err = auth.ReloadTokens(ctx, s.storage, account.ID)
		if err != nil {
			return err
		}
		if found {
			status, body, err = s.postMessage(ctx, broadcaster, text, tokens.AccessToken)
			if err != nil {
				return err
			}
		}
	}
	if status < 200 || status >= 300 {
		var payload struct {
			Error   string `json:"error"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(body, &payload)
		message := strings.TrimSpace(payload.Message)
		if message == "" {
			message = strings.TrimSpace(payload.Error)
		}
		if message == "" {
			message = fmt.Sprintf("Kick API returned HTTP %d", status)
		}
		return fmt.Errorf("send Kick message: %w: %s", ErrDeliveryRejected, message)
	}
	return nil
}

// SetTokenRefresher wires the OAuth refresher after construction, since the
// auth service is built after the platform services in main.
func (s *Service) SetTokenRefresher(refresher auth.TokenRefresher) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refresher = refresher
}

func (s *Service) refreshAccount(ctx context.Context, accountID string) bool {
	s.mu.Lock()
	refresher := s.refresher
	s.mu.Unlock()
	if refresher == nil {
		return false
	}
	if err := refresher.Refresh(ctx, accountID); err != nil {
		slog.Error("refresh Kick token after 401", "account", accountID, "error", err)
		return false
	}
	slog.Info("refreshed Kick token after 401", "account", accountID)
	return true
}

func (s *Service) postMessage(
	ctx context.Context,
	broadcaster int64,
	text, accessToken string,
) (int, []byte, error) {
	body, err := json.Marshal(map[string]any{"broadcaster_user_id": broadcaster, "content": text, "type": "user"})
	if err != nil {
		return 0, nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.chatAPIURL, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(request)
	if err != nil {
		return 0, nil, fmt.Errorf("send Kick message: %w", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 4<<10))
	if err != nil {
		return 0, nil, fmt.Errorf("send Kick message: read API rejection: %w", err)
	}
	return response.StatusCode, responseBody, nil
}
func (s *Service) Statuses() []contracts.PlatformStatusInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]contracts.PlatformStatusInfo, 0, len(s.statuses))
	for _, status := range s.statuses {
		result = append(result, status)
	}
	return result
}
func (s *Service) connect(ctx context.Context, channel string) error {
	slog.Info("resolve Kick chatroom", "channel", channel)
	var response kickChatroom
	if err := s.backend.GetJSON(ctx, "/api/kick/chatroom?slug="+channel, &response); err != nil {
		slog.Error("resolve Kick chatroom failed", "channel", channel, "error", err)
		s.emit(channel, "error", err.Error())
		return err
	}
	if response.BroadcasterUserID == 0 {
		err := errors.New("connect Kick chat: backend returned no broadcaster ID")
		slog.Error("resolve Kick chatroom failed", "channel", channel, "error", err)
		s.emit(channel, "error", err.Error())
		return err
	}
	s.cacheChannelIDs(channel, response.BroadcasterUserID, response.ChatroomID)
	if s.sevenTV != nil {
		s.sevenTV.Subscribe(ctx, seventv.Subscription{
			Platform: contracts.PlatformKick, ChannelID: channel, CanonicalChannelID: fmt.Sprint(response.BroadcasterUserID),
		})
	}
	s.emit(channel, "connected", "")
	slog.Info(
		"resolve Kick chatroom complete",
		"channel", channel,
		"broadcaster_id", response.BroadcasterUserID,
		"chatroom_id", response.ChatroomID,
	)
	s.startPusher(channel, response.ChatroomID)
	return nil
}
func (s *Service) emit(channel, status, failure string) {
	payload := contracts.PlatformStatusInfo{Platform: contracts.PlatformKick, ChannelLogin: channel, Status: status, Mode: "authenticated", Error: failure}
	s.mu.Lock()
	s.statuses[channel] = payload
	s.mu.Unlock()
	if failure == "" {
		slog.Info("Kick chat status", "channel", channel, "status", status)
	} else {
		slog.Error("Kick chat status", "channel", channel, "status", status, "error", failure)
	}
	s.events.Status(payload)
}
func normalize(channel string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(channel), "#"))
}

type kickChatroom struct {
	ChatroomID        int64 `json:"chatroomId"`
	BroadcasterUserID int64 `json:"broadcasterUserId"`
}
type pusherEnvelope struct {
	Event string          `json:"event"`
	Data  json.RawMessage `json:"data"`
}

type kickBadgeV1 struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type kickBadgeV2 struct {
	Name      string          `json:"name"`
	BadgeType string          `json:"badge_type"`
	ImageURL  string          `json:"image_url"`
	Metadata  json.RawMessage `json:"metadata"`
	Selected  bool            `json:"selected"`
	SortOrder int             `json:"sort_order"`
}

type kickIdentity struct {
	Color    string        `json:"color"`
	Badges   []kickBadgeV1 `json:"badges"`
	BadgesV2 []kickBadgeV2 `json:"badges_v2"`
}

type pusherChatMessage struct {
	ID         string `json:"id"`
	ChatroomID int64  `json:"chatroom_id"`
	Content    string `json:"content"`
	CreatedAt  string `json:"created_at"`
	Sender     struct {
		ID             int64        `json:"id"`
		Username       string       `json:"username"`
		Slug           string       `json:"slug"`
		ProfilePicture string       `json:"profile_picture"`
		Identity       kickIdentity `json:"identity"`
	} `json:"sender"`
}

// startPusher owns the reconnect loop for a channel. The loop runs on the
// service context (not the caller's request context) and is replaced wholesale
// on re-connect so at most one loop per channel ever runs.
func (s *Service) startPusher(channel string, chatroomID int64) {
	s.mu.Lock()
	if cancel := s.cancels[channel]; cancel != nil {
		cancel()
	}
	base := s.ctx
	if base == nil {
		base = context.Background()
	}
	ctx, cancel := context.WithCancel(base)
	s.cancels[channel] = cancel
	s.mu.Unlock()
	go s.runPusher(ctx, channel, chatroomID)
}

func (s *Service) runPusher(ctx context.Context, channel string, chatroomID int64) {
	delay := s.reconnectInitial
	for {
		established, err := s.pumpPusher(ctx, channel, chatroomID)
		if ctx.Err() != nil {
			return
		}
		if established {
			delay = s.reconnectInitial
		}
		slog.Error("Kick chat stream ended", "channel", channel, "error", err)
		s.emit(channel, "error", err.Error())
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		delay = min(delay*2, s.reconnectMaximum)
		s.emit(channel, "connecting", "")
	}
}

// pumpPusher dials the chat stream and reads until the connection drops.
// established reports whether the stream got as far as a subscribe attempt,
// which resets the reconnect backoff.
func (s *Service) pumpPusher(ctx context.Context, channel string, chatroomID int64) (bool, error) {
	slog.Info("dial Kick chat stream", "channel", channel, "chatroom_id", chatroomID)
	connection, _, err := websocket.Dial(ctx, s.pusherURL, nil)
	if err != nil {
		return false, fmt.Errorf("connect Kick chat stream: %w", err)
	}
	s.mu.Lock()
	s.connections[channel] = connection
	s.mu.Unlock()
	established := false
	defer func() {
		_ = connection.CloseNow()
		s.mu.Lock()
		if s.connections[channel] == connection {
			delete(s.connections, channel)
		}
		s.mu.Unlock()
	}()
	for {
		_, payload, err := connection.Read(ctx)
		if err != nil {
			return established, fmt.Errorf("read Kick chat stream: %w", err)
		}
		var envelope pusherEnvelope
		if err := json.Unmarshal(payload, &envelope); err != nil {
			continue
		}
		switch envelope.Event {
		case "pusher:connection_established":
			slog.Info("Kick chat stream connected", "channel", channel, "chatroom_id", chatroomID)
			established = true
			data, _ := json.Marshal(map[string]any{"event": "pusher:subscribe", "data": map[string]any{"auth": "", "channel": fmt.Sprintf("chatrooms.%d.v2", chatroomID)}})
			if err := connection.Write(ctx, websocket.MessageText, data); err != nil {
				return established, fmt.Errorf("subscribe Kick chat stream: %w", err)
			}
		case "pusher_internal:subscription_succeeded":
			s.emit(channel, "connected", "")
		case "pusher:ping":
			data, _ := json.Marshal(map[string]any{"event": "pusher:pong", "data": map[string]any{}})
			_ = connection.Write(ctx, websocket.MessageText, data)
		case `App\Events\ChatMessageEvent`:
			s.handlePusherMessage(ctx, channel, envelope.Data)
		case `App\Events\MessageDeletedEvent`, `App\Events\UserBannedEvent`:
			if outcome, ok := parsePusherModerationOutcome(channel, envelope.Event, envelope.Data, time.Now().UTC()); ok {
				s.events.Moderation(outcome)
			}
		}
	}
}

// parsePusherModerationOutcome handles the moderation subset of the existing
// public chatroom Pusher stream. Kick does not document it as a stable API, so
// malformed frames are ignored instead of producing an incorrect chat state.
func parsePusherModerationOutcome(
	channel, event string,
	raw json.RawMessage,
	now time.Time,
) (contracts.ModerationOutcome, bool) {
	if channel == "" {
		return contracts.ModerationOutcome{}, false
	}
	var encoded string
	if err := json.Unmarshal(raw, &encoded); err == nil {
		raw = []byte(encoded)
	}

	switch event {
	case `App\Events\MessageDeletedEvent`:
		var payload struct {
			Message struct {
				ID string `json:"id"`
			} `json:"message"`
		}
		if err := json.Unmarshal(raw, &payload); err != nil || payload.Message.ID == "" {
			return contracts.ModerationOutcome{}, false
		}
		return contracts.ModerationOutcome{
			Platform: contracts.PlatformKick, ChannelID: channel, Action: "delete_message", MessageID: payload.Message.ID,
		}, true
	case `App\Events\UserBannedEvent`:
		var payload struct {
			User struct {
				ID int64 `json:"id"`
			} `json:"user"`
			ExpiresAt *time.Time `json:"expires_at"`
		}
		if err := json.Unmarshal(raw, &payload); err != nil || payload.User.ID == 0 {
			return contracts.ModerationOutcome{}, false
		}
		outcome := contracts.ModerationOutcome{
			Platform: contracts.PlatformKick, ChannelID: channel, Action: "ban", TargetUserID: fmt.Sprint(payload.User.ID),
		}
		if payload.ExpiresAt == nil {
			return outcome, true
		}
		seconds := int(math.Ceil(payload.ExpiresAt.Sub(now).Seconds()))
		if seconds <= 0 {
			return contracts.ModerationOutcome{}, false
		}
		outcome.Action = "timeout"
		outcome.DurationSeconds = seconds
		return outcome, true
	default:
		return contracts.ModerationOutcome{}, false
	}
}

func (s *Service) handlePusherMessage(ctx context.Context, channel string, raw json.RawMessage) {
	var encoded string
	if err := json.Unmarshal(raw, &encoded); err == nil {
		raw = []byte(encoded)
	}
	var incoming pusherChatMessage
	if err := json.Unmarshal(raw, &incoming); err != nil {
		return
	}
	timestamp, err := time.Parse(time.RFC3339, incoming.CreatedAt)
	if err != nil {
		timestamp = time.Now().UTC()
	}
	badges := normalizeBadges(incoming.Sender.Identity.Badges, incoming.Sender.Identity.BadgesV2)
	text, emotes := parseKickEmotes(incoming.Content)
	message := contracts.NormalizedChatMessage{ID: incoming.ID, Platform: contracts.PlatformKick, ChannelID: channel, Author: contracts.ChatAuthor{ID: fmt.Sprint(incoming.Sender.ID), Username: incoming.Sender.Username, DisplayName: incoming.Sender.Username, Color: incoming.Sender.Identity.Color, AvatarURL: incoming.Sender.ProfilePicture, Badges: badges}, Text: text, Emotes: emotes, Timestamp: timestamp, Type: "message"}
	if message.ID == "" {
		message.ID = fmt.Sprintf("kick:%d:%d", incoming.ChatroomID, timestamp.UnixNano())
	}
	if s.sevenTV != nil {
		message = s.sevenTV.Enrich(message)
	}
	if err := s.storage.SaveMessage(ctx, message); err != nil {
		s.emit(channel, "error", fmt.Sprintf("persist Kick chat message: %v", err))
		return
	}
	s.events.Message(message)
}

func parseKickEmotes(content string) (string, []contracts.Emote) {
	var clean strings.Builder
	emotes := make([]contracts.Emote, 0)
	rest := content
	cleanPosition := 0

	for {
		start := strings.Index(rest, "[emote:")
		if start < 0 {
			clean.WriteString(rest)
			break
		}

		prefix := rest[:start]
		clean.WriteString(prefix)
		cleanPosition += utf16CodeUnits(prefix)

		tagRest := rest[start:]
		end := strings.IndexByte(tagRest, ']')
		if end < 0 {
			clean.WriteString(tagRest)
			break
		}

		tag := tagRest[:end+1]
		inner := tag[len("[emote:") : len(tag)-1]
		id, name, valid := strings.Cut(inner, ":")
		if !valid || id == "" || name == "" {
			clean.WriteString(tag)
			cleanPosition += utf16CodeUnits(tag)
			rest = tagRest[end+1:]
			continue
		}

		nameLength := utf16CodeUnits(name)
		clean.WriteString(name)
		emotes = append(emotes, contracts.Emote{
			ID:       id,
			Name:     name,
			ImageURL: "https://files.kick.com/emotes/" + id + "/fullsize",
			Positions: []contracts.EmotePosition{{
				Start: cleanPosition,
				End:   cleanPosition + nameLength - 1,
			}},
		})
		cleanPosition += nameLength
		rest = tagRest[end+1:]
	}

	return clean.String(), emotes
}

func utf16CodeUnits(value string) int {
	return len(utf16.Encode([]rune(value)))
}
