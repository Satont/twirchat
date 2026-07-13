package kick

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
	"github.com/coder/websocket"
)

const (
	defaultChatAPIURL = "https://api.kick.com/public/v1/chat"
	pusherURL         = "wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=twirchat&version=1.0&flash=false"
)

type Events interface {
	Status(contracts.PlatformStatusInfo)
	Message(contracts.NormalizedChatMessage)
}
type Config struct {
	Storage    *storage.Storage
	Events     Events
	Backend    *backend.HTTPClient
	ChatAPIURL string
}
type Service struct {
	storage     *storage.Storage
	events      Events
	backend     *backend.HTTPClient
	chatAPIURL  string
	client      *http.Client
	mu          sync.Mutex
	channels    map[string]int64
	chatrooms   map[string]int64
	connections map[string]*websocket.Conn
	statuses    map[string]contracts.PlatformStatusInfo
}

func NewService(config Config) (*Service, error) {
	if config.Storage == nil || config.Events == nil || config.Backend == nil {
		return nil, errors.New("create Kick service: storage, events, and backend are required")
	}
	if config.ChatAPIURL == "" {
		config.ChatAPIURL = defaultChatAPIURL
	}
	return &Service{storage: config.Storage, events: config.Events, backend: config.Backend, chatAPIURL: config.ChatAPIURL, client: http.DefaultClient, channels: map[string]int64{}, chatrooms: map[string]int64{}, connections: map[string]*websocket.Conn{}, statuses: map[string]contracts.PlatformStatusInfo{}}, nil
}
func (s *Service) Start(ctx context.Context) error {
	channels, err := s.storage.ChannelsByPlatform(ctx, contracts.PlatformKick)
	if err != nil {
		return err
	}
	log.Printf("kick chat: service start persisted_channels=%d", len(channels))
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
	s.mu.Unlock()
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
	log.Printf("kick chat: join requested channel=%s", channel)
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
	log.Printf("kick chat: leave requested channel=%s", channel)
	if err := s.storage.RemoveChannel(ctx, contracts.PlatformKick, channel); err != nil {
		return err
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
	log.Printf("kick chat: send requested channel=%s", channel)
	account, err := s.storage.FindAccountByPlatform(ctx, contracts.PlatformKick)
	if err != nil {
		return err
	}
	if account == nil {
		return errors.New("send Kick message: authenticate with Kick before sending messages")
	}
	tokens, found, err := s.storage.AccountTokens(ctx, account.ID)
	if err != nil {
		return err
	}
	if !found {
		return errors.New("send Kick message: credentials are unavailable")
	}
	s.mu.Lock()
	broadcaster := s.channels[channel]
	s.mu.Unlock()
	if broadcaster == 0 {
		if err := s.connect(ctx, channel); err != nil {
			return err
		}
		s.mu.Lock()
		broadcaster = s.channels[channel]
		s.mu.Unlock()
	}
	body, err := json.Marshal(map[string]any{"broadcaster_user_id": broadcaster, "content": text, "type": "user"})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.chatAPIURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+tokens.AccessToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(request)
	if err != nil {
		return fmt.Errorf("send Kick message: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("send Kick message: API returned HTTP %d", response.StatusCode)
	}
	return nil
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
	log.Printf("kick chat: resolve chatroom channel=%s", channel)
	var response kickChatroom
	if err := s.backend.GetJSON(ctx, "/api/kick/chatroom?slug="+channel, &response); err != nil {
		log.Printf("kick chat: resolve chatroom failed channel=%s error=%v", channel, err)
		s.emit(channel, "error", err.Error())
		return err
	}
	if response.BroadcasterUserID == 0 {
		err := errors.New("connect Kick chat: backend returned no broadcaster ID")
		log.Printf("kick chat: resolve chatroom failed channel=%s error=%v", channel, err)
		s.emit(channel, "error", err.Error())
		return err
	}
	s.mu.Lock()
	s.channels[channel] = response.BroadcasterUserID
	s.chatrooms[channel] = response.ChatroomID
	s.mu.Unlock()
	s.emit(channel, "connected", "")
	log.Printf("kick chat: chatroom resolved channel=%s broadcaster=%d chatroom=%d", channel, response.BroadcasterUserID, response.ChatroomID)
	go s.runPusher(ctx, channel, response.ChatroomID)
	return nil
}
func (s *Service) emit(channel, status, failure string) {
	payload := contracts.PlatformStatusInfo{Platform: contracts.PlatformKick, ChannelLogin: channel, Status: status, Mode: "authenticated", Error: failure}
	s.mu.Lock()
	s.statuses[channel] = payload
	s.mu.Unlock()
	if failure == "" {
		log.Printf("kick chat: status channel=%s status=%s", channel, status)
	} else {
		log.Printf("kick chat: status channel=%s status=%s error=%s", channel, status, failure)
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

func (s *Service) runPusher(ctx context.Context, channel string, chatroomID int64) {
	log.Printf("kick chat: pusher dialing channel=%s chatroom=%d", channel, chatroomID)
	connection, _, err := websocket.Dial(ctx, pusherURL, nil)
	if err != nil {
		log.Printf("kick chat: pusher dial failed channel=%s error=%v", channel, err)
		s.emit(channel, "error", fmt.Sprintf("connect Kick chat stream: %v", err))
		return
	}
	s.mu.Lock()
	s.connections[channel] = connection
	s.mu.Unlock()
	defer func() { _ = connection.CloseNow(); s.mu.Lock(); delete(s.connections, channel); s.mu.Unlock() }()
	for {
		_, payload, err := connection.Read(ctx)
		if err != nil {
			if ctx.Err() == nil {
				log.Printf("kick chat: pusher read failed channel=%s error=%v", channel, err)
				s.emit(channel, "error", fmt.Sprintf("read Kick chat stream: %v", err))
			}
			return
		}
		var envelope pusherEnvelope
		if err := json.Unmarshal(payload, &envelope); err != nil {
			continue
		}
		switch envelope.Event {
		case "pusher:connection_established":
			log.Printf("kick chat: pusher connected channel=%s chatroom=%d", channel, chatroomID)
			data, _ := json.Marshal(map[string]any{"event": "pusher:subscribe", "data": map[string]any{"auth": "", "channel": fmt.Sprintf("chatrooms.%d.v2", chatroomID)}})
			if err := connection.Write(ctx, websocket.MessageText, data); err != nil {
				log.Printf("kick chat: pusher subscribe failed channel=%s error=%v", channel, err)
				s.emit(channel, "error", fmt.Sprintf("subscribe Kick chat stream: %v", err))
				return
			}
		case "pusher:ping":
			data, _ := json.Marshal(map[string]any{"event": "pusher:pong", "data": map[string]any{}})
			_ = connection.Write(ctx, websocket.MessageText, data)
		case `App\Events\ChatMessageEvent`:
			s.handlePusherMessage(ctx, channel, envelope.Data)
		}
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
	message := contracts.NormalizedChatMessage{ID: incoming.ID, Platform: contracts.PlatformKick, ChannelID: channel, Author: contracts.ChatAuthor{ID: fmt.Sprint(incoming.Sender.ID), Username: incoming.Sender.Username, DisplayName: incoming.Sender.Username, Color: incoming.Sender.Identity.Color, AvatarURL: incoming.Sender.ProfilePicture, Badges: badges}, Text: incoming.Content, Emotes: []contracts.Emote{}, Timestamp: timestamp, Type: "message"}
	if message.ID == "" {
		message.ID = fmt.Sprintf("kick:%d:%d", incoming.ChatroomID, timestamp.UnixNano())
	}
	if err := s.storage.SaveMessage(ctx, message); err != nil {
		s.emit(channel, "error", fmt.Sprintf("persist Kick chat message: %v", err))
		return
	}
	s.events.Message(message)
}
