package kick

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

const defaultChatAPIURL = "https://api.kick.com/public/v1/chat"

type Events interface {
	Status(contracts.PlatformStatusInfo)
}
type Config struct {
	Storage    *storage.Storage
	Events     Events
	Backend    *backend.HTTPClient
	ChatAPIURL string
}
type Service struct {
	storage    *storage.Storage
	events     Events
	backend    *backend.HTTPClient
	chatAPIURL string
	client     *http.Client
	mu         sync.Mutex
	channels   map[string]int64
	statuses   map[string]contracts.PlatformStatusInfo
}

func NewService(config Config) (*Service, error) {
	if config.Storage == nil || config.Events == nil || config.Backend == nil {
		return nil, errors.New("create Kick service: storage, events, and backend are required")
	}
	if config.ChatAPIURL == "" {
		config.ChatAPIURL = defaultChatAPIURL
	}
	return &Service{storage: config.Storage, events: config.Events, backend: config.Backend, chatAPIURL: config.ChatAPIURL, client: http.DefaultClient, channels: map[string]int64{}, statuses: map[string]contracts.PlatformStatusInfo{}}, nil
}
func (s *Service) Start(ctx context.Context) error {
	channels, err := s.storage.ChannelsByPlatform(ctx, contracts.PlatformKick)
	if err != nil {
		return err
	}
	for _, channel := range channels {
		if err := s.connect(ctx, channel); err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) Stop(context.Context) error { return nil }
func (s *Service) Join(ctx context.Context, channel string) error {
	channel = normalize(channel)
	if err := s.storage.SaveChannel(ctx, contracts.PlatformKick, channel); err != nil {
		return err
	}
	return s.connect(ctx, channel)
}
func (s *Service) Leave(ctx context.Context, channel string) error {
	channel = normalize(channel)
	if err := s.storage.RemoveChannel(ctx, contracts.PlatformKick, channel); err != nil {
		return err
	}
	s.emit(channel, "disconnected", "")
	return nil
}
func (s *Service) Send(ctx context.Context, channel, text, _ string) error {
	channel = normalize(channel)
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
	var response struct {
		BroadcasterUserID int64 `json:"broadcasterUserId"`
	}
	if err := s.backend.GetJSON(ctx, "/api/kick/chatroom?slug="+channel, &response); err != nil {
		s.emit(channel, "error", err.Error())
		return err
	}
	if response.BroadcasterUserID == 0 {
		return errors.New("connect Kick chat: backend returned no broadcaster ID")
	}
	s.mu.Lock()
	s.channels[channel] = response.BroadcasterUserID
	s.mu.Unlock()
	s.emit(channel, "connected", "")
	return nil
}
func (s *Service) emit(channel, status, failure string) {
	payload := contracts.PlatformStatusInfo{Platform: contracts.PlatformKick, ChannelLogin: channel, Status: status, Mode: "authenticated", Error: failure}
	s.mu.Lock()
	s.statuses[channel] = payload
	s.mu.Unlock()
	s.events.Status(payload)
}
func normalize(channel string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(channel), "#"))
}
