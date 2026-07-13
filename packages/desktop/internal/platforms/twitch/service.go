// Package twitch owns the authenticated Twitch IRC chat lifecycle.
package twitch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/seventv"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
	twitchirc "github.com/gempir/go-twitch-irc/v4"
	"github.com/google/uuid"
)

const defaultConnectTimeout = 15 * time.Second

// Credentials are resolved from the encrypted profile store before a chat
// connection is made. AccessToken is never sent to the frontend.
type Credentials struct {
	AccessToken    string
	AccountID      string
	DisplayName    string
	PlatformUserID string
	Username       string
}

// Author and IncomingMessage are the small transport-neutral projection of a
// Twitch IRC PRIVMSG. They make the service unit-testable while ircClient
// remains the only gempir/go-twitch-irc adapter.
type Author struct {
	ID          string
	Username    string
	DisplayName string
	Color       string
	Badges      []contracts.Badge
}

type Emote struct {
	ID    string
	Name  string
	Start int
	End   int
}

type IncomingMessage struct {
	ID        string
	Channel   string
	Text      string
	Timestamp time.Time
	Action    bool
	Author    Author
	Emotes    []Emote
	Reply     *contracts.MessageReply
}

// Notice is Twitch's server acknowledgement for room settings, moderation,
// and rejected chat messages. It is deliberately transport-neutral so the
// service can surface delivery failures without exposing the IRC library.
type Notice struct {
	Channel string
	MsgID   string
	Message string
}

// Client captures the gempir IRC operations used by the lifecycle service.
type Client interface {
	OnConnect(func())
	OnMessage(func(IncomingMessage))
	OnNotice(func(Notice))
	Join(string)
	Depart(string)
	Say(string, string)
	Reply(string, string, string)
	Connect() error
	Disconnect() error
}

type ClientFactory func(Credentials) (Client, error)

// Events keeps Wails event delivery outside the transport implementation.
type Events interface {
	Message(contracts.NormalizedChatMessage)
	Status(contracts.PlatformStatusInfo)
}

type Config struct {
	Storage        *storage.Storage
	Events         Events
	Backend        *backend.HTTPClient
	NewClient      ClientFactory
	Badges         BadgeResolver
	ConnectTimeout time.Duration
	SevenTV        seventv.ChannelService
}

// Service reconnects saved Twitch channels, persists incoming messages and
// exposes join/leave/send operations for the Wails request bridge.
type Service struct {
	storage   *storage.Storage
	events    Events
	newClient ClientFactory
	badges    BadgeResolver
	backend   *backend.HTTPClient
	sevenTV   seventv.ChannelService

	mu             sync.Mutex
	account        *contracts.Account
	channels       map[string]struct{}
	client         Client
	connected      bool
	connecting     bool
	credentials    Credentials
	statuses       map[string]contracts.PlatformStatusInfo
	connectTimeout time.Duration
	ctx            context.Context
	started        bool
}

func NewService(config Config) (*Service, error) {
	if config.Storage == nil {
		return nil, errors.New("twitch service storage is required")
	}
	if config.Events == nil {
		return nil, errors.New("twitch service events are required")
	}
	if config.NewClient == nil {
		config.NewClient = newIRCClient
	}
	if config.Badges == nil {
		config.Badges = passthroughBadgeResolver{}
	}
	if config.ConnectTimeout <= 0 {
		config.ConnectTimeout = defaultConnectTimeout
	}
	return &Service{
		storage:        config.Storage,
		events:         config.Events,
		newClient:      config.NewClient,
		badges:         config.Badges,
		backend:        config.Backend,
		sevenTV:        config.SevenTV,
		channels:       make(map[string]struct{}),
		statuses:       make(map[string]contracts.PlatformStatusInfo),
		connectTimeout: config.ConnectTimeout,
	}, nil
}

func (s *Service) Start(ctx context.Context) error {
	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return errors.New("twitch service has already started")
	}
	s.started = true
	s.ctx = ctx
	s.mu.Unlock()
	if err := s.storage.PurgeLegacyOptimisticMessages(ctx); err != nil {
		return fmt.Errorf("start Twitch service: %w", err)
	}
	log.Printf("twitch chat: service start")
	return s.connectSavedChannels(ctx, false)
}

func (s *Service) Stop(context.Context) error {
	s.mu.Lock()
	client := s.client
	s.client = nil
	s.connected = false
	s.connecting = false
	channels := s.channelNamesLocked()
	s.mu.Unlock()
	if client != nil {
		if err := client.Disconnect(); err != nil {
			return fmt.Errorf("disconnect Twitch IRC: %w", err)
		}
	}
	for _, channel := range channels {
		s.emitStatus(channel, "disconnected", "")
	}
	return nil
}

// RefreshCredentials reconnects saved channels after the OAuth callback has
// written a new Twitch account to the encrypted local profile.
func (s *Service) RefreshCredentials(ctx context.Context) error {
	log.Printf("twitch chat: refreshing authenticated IRC credentials")
	s.mu.Lock()
	client := s.client
	s.client = nil
	s.connected = false
	s.connecting = false
	s.mu.Unlock()
	if client != nil {
		if err := client.Disconnect(); err != nil {
			return fmt.Errorf("disconnect Twitch IRC before credential refresh: %w", err)
		}
	}
	return s.connectSavedChannels(ctx, true)
}

func (s *Service) Join(ctx context.Context, channel string) error {
	channel = normalizeChannel(channel)
	if channel == "" {
		return errors.New("join Twitch channel: channel slug is required")
	}
	if err := s.storage.SaveChannel(ctx, contracts.PlatformTwitch, channel); err != nil {
		return err
	}
	s.mu.Lock()
	credentials := s.credentials
	s.mu.Unlock()
	s.subscribeSevenTV(ctx, channel, credentials)
	log.Printf("twitch chat: join requested channel=%s", channel)

	s.mu.Lock()
	s.channels[channel] = struct{}{}
	client := s.client
	connected := s.connected
	s.mu.Unlock()
	if client == nil {
		return s.connectSavedChannels(ctx, false)
	}
	client.Join(channel)
	if connected {
		s.emitStatus(channel, "connected", "")
	} else {
		s.emitStatus(channel, "connecting", "")
	}
	return nil
}

func (s *Service) Leave(ctx context.Context, channel string) error {
	channel = normalizeChannel(channel)
	if channel == "" {
		return errors.New("leave Twitch channel: channel slug is required")
	}
	if err := s.storage.RemoveChannel(ctx, contracts.PlatformTwitch, channel); err != nil {
		return err
	}
	if s.sevenTV != nil {
		s.sevenTV.Unsubscribe(ctx, contracts.PlatformTwitch, channel)
	}
	log.Printf("twitch chat: leave requested channel=%s", channel)
	s.mu.Lock()
	delete(s.channels, channel)
	client := s.client
	s.mu.Unlock()
	if client != nil {
		client.Depart(channel)
	}
	s.emitStatus(channel, "disconnected", "")
	return nil
}

func (s *Service) Send(ctx context.Context, channel, text, replyToMessageID string) error {
	channel = normalizeChannel(channel)
	if channel == "" {
		return errors.New("send Twitch message: channel is required")
	}
	if strings.TrimSpace(text) == "" {
		return errors.New("send Twitch message: text is required")
	}
	log.Printf("twitch chat: send requested channel=%s reply=%t", channel, replyToMessageID != "")
	account, err := s.storage.FindAccountByPlatform(ctx, contracts.PlatformTwitch)
	if err != nil {
		return fmt.Errorf("send Twitch message: load Twitch account: %w", err)
	}
	if account == nil {
		return errors.New("send Twitch message: authenticate with Twitch before sending messages")
	}
	if !hasScope(account.Scopes, "user:write:chat") {
		return errors.New("send Twitch message: Reconnect Twitch to grant the user:write:chat permission")
	}
	if s.backend == nil {
		return errors.New("send Twitch message: backend API client is unavailable")
	}
	tokens, found, err := s.storage.AccountTokens(ctx, account.ID)
	if err != nil {
		return fmt.Errorf("send Twitch message: load Twitch credentials: %w", err)
	}
	if !found || tokens.AccessToken == "" {
		return errors.New("send Twitch message: credentials are unavailable")
	}
	if account.PlatformUserID == "" {
		return errors.New("send Twitch message: authenticated account has no Twitch user ID")
	}
	var response struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Sent    bool   `json:"sent"`
	}
	request := struct {
		AccessToken      string `json:"accessToken"`
		ChannelLogin     string `json:"channelLogin"`
		Message          string `json:"message"`
		ReplyToMessageID string `json:"replyToMessageId,omitempty"`
		SenderID         string `json:"senderId"`
	}{
		AccessToken: tokens.AccessToken, ChannelLogin: channel, Message: text,
		ReplyToMessageID: replyToMessageID, SenderID: account.PlatformUserID,
	}
	if err := s.backend.PostJSON(ctx, "/api/twitch/send-message", request, &response); err != nil {
		return fmt.Errorf("send Twitch message through API: %w", deliveryError(err))
	}
	if !response.Sent {
		if response.Message == "" {
			response.Message = "Twitch did not accept the message"
		}
		if response.Code != "" {
			return fmt.Errorf("send Twitch message: %s (%s)", response.Message, response.Code)
		}
		return fmt.Errorf("send Twitch message: %s", response.Message)
	}
	return nil
}

func hasScope(scopes []string, required string) bool {
	for _, scope := range scopes {
		if scope == required {
			return true
		}
	}
	return false
}

func deliveryError(err error) error {
	var statusError *backend.HTTPStatusError
	if !errors.As(err, &statusError) {
		return err
	}
	var payload struct {
		Error string `json:"error"`
	}
	if json.Unmarshal([]byte(statusError.Body), &payload) == nil && payload.Error != "" {
		return errors.New(payload.Error)
	}
	return err
}

// Statuses returns the latest immutable snapshot used by the Vue bootstrap
// request, so fast IRC connection events are not lost before the frontend has
// subscribed to Wails events.
func (s *Service) Statuses() []contracts.PlatformStatusInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	statuses := make([]contracts.PlatformStatusInfo, 0, len(s.statuses))
	for _, status := range s.statuses {
		statuses = append(statuses, status)
	}
	return statuses
}

func (s *Service) connectSavedChannels(ctx context.Context, force bool) error {
	channels, err := s.storage.ChannelsByPlatform(ctx, contracts.PlatformTwitch)
	if err != nil {
		return err
	}
	if len(channels) == 0 {
		log.Printf("twitch chat: no persisted channels to connect")
		return nil
	}
	log.Printf("twitch chat: prepare IRC connection force=%t channels=%s", force, strings.Join(channels, ","))
	account, err := s.storage.FindAccountByPlatform(ctx, contracts.PlatformTwitch)
	if err != nil {
		return err
	}
	credentials := Credentials{}
	if account != nil {
		tokens, found, err := s.storage.AccountTokens(ctx, account.ID)
		if err != nil {
			return err
		}
		if found {
			credentials = Credentials{
				AccessToken: tokens.AccessToken, AccountID: account.ID, DisplayName: account.DisplayName,
				PlatformUserID: account.PlatformUserID, Username: account.Username,
			}
		}
	}
	for _, channel := range channels {
		s.subscribeSevenTV(ctx, channel, credentials)
	}
	if credentials.AccessToken == "" {
		log.Printf("twitch chat: cannot connect channels=%s: no authenticated access token", strings.Join(channels, ","))
		for _, channel := range channels {
			s.emitStatus(channel, "error", "authenticate with Twitch before connecting to chat")
		}
		return nil
	}

	s.mu.Lock()
	if s.client != nil && !force {
		for _, channel := range channels {
			s.channels[channel] = struct{}{}
		}
		s.mu.Unlock()
		return nil
	}
	s.mu.Unlock()

	client, err := s.newClient(credentials)
	if err != nil {
		return fmt.Errorf("create Twitch IRC client: %w", err)
	}
	client.OnConnect(func() { s.onConnect(client) })
	client.OnMessage(s.onMessage)
	client.OnNotice(s.onNotice)

	s.mu.Lock()
	s.account = account
	s.credentials = credentials
	s.client = client
	s.connecting = true
	for _, channel := range channels {
		s.channels[channel] = struct{}{}
		client.Join(channel)
	}
	s.mu.Unlock()
	log.Printf("twitch chat: IRC Connect starting account=%s channels=%s", credentials.Username, strings.Join(channels, ","))
	for _, channel := range channels {
		s.emitStatus(channel, "connecting", "")
	}
	s.armConnectTimeout(client)
	go s.runConnect(client)
	return nil
}

func (s *Service) runConnect(client Client) {
	err := client.Connect()
	if err == nil {
		log.Printf("twitch chat: IRC Connect returned without an error")
	} else {
		log.Printf("twitch chat: IRC Connect returned error: %v", err)
	}
	s.mu.Lock()
	if s.client != client {
		s.mu.Unlock()
		return
	}
	wasConnected := s.connected
	s.client = nil
	s.connected = false
	s.connecting = false
	channels := s.channelNamesLocked()
	s.mu.Unlock()
	if wasConnected {
		for _, channel := range channels {
			s.emitStatus(channel, "disconnected", "Twitch IRC connection closed")
		}
		return
	}
	failure := "Twitch IRC connection closed before authentication completed"
	if err != nil {
		failure = err.Error()
	}
	for _, channel := range channels {
		s.emitStatus(channel, "error", failure)
	}
}

func (s *Service) onConnect(client Client) {
	s.mu.Lock()
	if s.client != client {
		s.mu.Unlock()
		return
	}
	s.connected = true
	s.connecting = false
	channels := s.channelNamesLocked()
	s.mu.Unlock()
	log.Printf("twitch chat: IRC connected channels=%s", strings.Join(channels, ","))
	for _, channel := range channels {
		s.emitStatus(channel, "connected", "")
	}
}

func (s *Service) armConnectTimeout(client Client) {
	time.AfterFunc(s.connectTimeout, func() {
		s.mu.Lock()
		if s.client != client || s.connected || !s.connecting {
			s.mu.Unlock()
			return
		}
		s.client = nil
		s.connecting = false
		channels := s.channelNamesLocked()
		s.mu.Unlock()
		log.Printf("twitch chat: IRC connection timed out after %s channels=%s", s.connectTimeout, strings.Join(channels, ","))
		if err := client.Disconnect(); err != nil && !errors.Is(err, twitchirc.ErrConnectionIsNotOpen) {
			log.Printf("twitch chat: disconnect timed out IRC client: %v", err)
		}
		for _, channel := range channels {
			s.emitStatus(channel, "error", fmt.Sprintf("Twitch IRC connection timed out after %s", s.connectTimeout))
		}
	})
}

func (s *Service) onMessage(incoming IncomingMessage) {
	badges, err := s.badges.Resolve(s.serviceContext(), incoming.Channel, incoming.Author.Badges)
	if err != nil {
		s.emitStatus(normalizeChannel(incoming.Channel), "error", fmt.Sprintf("resolve Twitch badges: %v", err))
		badges = incoming.Author.Badges
	}
	message := contracts.NormalizedChatMessage{
		ID:        incoming.ID,
		Platform:  contracts.PlatformTwitch,
		ChannelID: normalizeChannel(incoming.Channel),
		Author: contracts.ChatAuthor{
			ID: incoming.Author.ID, Username: incoming.Author.Username, DisplayName: incoming.Author.DisplayName,
			Color: incoming.Author.Color, Badges: badges,
		},
		Text: incoming.Text, Timestamp: incoming.Timestamp.UTC(), Type: "message", Reply: incoming.Reply,
		Emotes: make([]contracts.Emote, 0, len(incoming.Emotes)),
	}
	if message.ID == "" {
		message.ID = "twitch:" + message.ChannelID + ":" + uuid.NewString()
	}
	if message.Timestamp.IsZero() {
		message.Timestamp = time.Now().UTC()
	}
	if incoming.Action {
		message.Type = "action"
	}
	for _, emote := range incoming.Emotes {
		message.Emotes = append(message.Emotes, contracts.Emote{
			ID: emote.ID, Name: emote.Name,
			ImageURL:  "https://static-cdn.jtvnw.net/emoticons/v2/" + emote.ID + "/default/dark/1.0",
			Positions: []contracts.EmotePosition{{Start: emote.Start, End: emote.End}},
		})
	}
	if s.sevenTV != nil {
		message = s.sevenTV.Enrich(message)
	}
	if err := s.storage.SaveMessage(s.serviceContext(), message); err != nil {
		s.emitStatus(message.ChannelID, "error", fmt.Sprintf("persist Twitch message: %v", err))
		return
	}
	s.events.Message(message)
}

func (s *Service) subscribeSevenTV(ctx context.Context, channel string, credentials Credentials) {
	if s.sevenTV == nil {
		return
	}
	platformUserID := ""
	if normalizeChannel(credentials.Username) == normalizeChannel(channel) {
		platformUserID = credentials.PlatformUserID
	}
	s.sevenTV.Subscribe(ctx, seventv.Subscription{
		Platform:           contracts.PlatformTwitch,
		ChannelID:          channel,
		CanonicalChannelID: channel,
		PlatformUserID:     platformUserID,
	})
}

func (s *Service) onNotice(notice Notice) {
	channel := normalizeChannel(notice.Channel)
	log.Printf("twitch chat: server notice channel=%s msg_id=%s message=%s", channel, notice.MsgID, notice.Message)
	if channel == "" || !isDeliveryFailure(notice.MsgID) {
		return
	}
	s.emitStatus(channel, "error", notice.Message)
}

func isDeliveryFailure(msgID string) bool {
	return strings.HasPrefix(msgID, "msg_") ||
		strings.Contains(msgID, "banned") ||
		strings.Contains(msgID, "suspended") ||
		strings.Contains(msgID, "no_permission")
}

func (s *Service) emitStatus(channel, status, failure string) {
	s.mu.Lock()
	payload := contracts.PlatformStatusInfo{
		Platform: contracts.PlatformTwitch, ChannelLogin: channel, Status: status, Mode: "authenticated", Error: failure,
	}
	s.statuses[channel] = payload
	s.mu.Unlock()
	if failure == "" {
		log.Printf("twitch chat: status channel=%s status=%s", channel, status)
	} else {
		log.Printf("twitch chat: status channel=%s status=%s error=%s", channel, status, failure)
	}
	s.events.Status(payload)
}

func (s *Service) replyContext(ctx context.Context, id string) *contracts.MessageReply {
	messages, err := s.storage.RecentMessages(ctx, 250)
	if err != nil {
		return nil
	}
	for _, message := range messages {
		if message.ID == id {
			return &contracts.MessageReply{ParentMessageID: id, ParentMessageText: message.Text, ParentAuthor: contracts.ReplyAuthor{
				ID: message.Author.ID, Username: message.Author.Username, DisplayName: message.Author.DisplayName,
			}}
		}
	}
	return nil
}

func (s *Service) serviceContext() context.Context {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ctx == nil {
		return context.Background()
	}
	return s.ctx
}

func (s *Service) channelNames() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.channelNamesLocked()
}

func (s *Service) channelNamesLocked() []string {
	channels := make([]string, 0, len(s.channels))
	for channel := range s.channels {
		channels = append(channels, channel)
	}
	return channels
}

func normalizeChannel(channel string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(channel), "#"))
}

type ircClient struct{ client *twitchirc.Client }

func newIRCClient(credentials Credentials) (Client, error) {
	if credentials.AccessToken == "" {
		return nil, errors.New("authenticated Twitch access token is required")
	}
	if credentials.Username == "" {
		return nil, errors.New("authenticated Twitch account username is required")
	}
	token := credentials.AccessToken
	if !strings.HasPrefix(token, "oauth:") {
		token = "oauth:" + token
	}
	return &ircClient{client: twitchirc.NewClient(credentials.Username, token)}, nil
}

func (c *ircClient) OnConnect(handler func()) { c.client.OnConnect(handler) }

func (c *ircClient) OnMessage(handler func(IncomingMessage)) {
	c.client.OnPrivateMessage(func(message twitchirc.PrivateMessage) {
		emotes := make([]Emote, 0)
		for _, emote := range message.Emotes {
			for _, position := range emote.Positions {
				emotes = append(emotes, Emote{ID: emote.ID, Name: emote.Name, Start: position.Start, End: position.End})
			}
		}
		badges := make([]contracts.Badge, 0, len(message.User.Badges))
		for badgeType, version := range message.User.Badges {
			badges = append(badges, contracts.Badge{ID: fmt.Sprintf("%s/%d", badgeType, version), Type: badgeType, Text: badgeType})
		}
		var reply *contracts.MessageReply
		if message.Reply != nil {
			reply = &contracts.MessageReply{ParentMessageID: message.Reply.ParentMsgID, ParentMessageText: message.Reply.ParentMsgBody, ParentAuthor: contracts.ReplyAuthor{
				ID: message.Reply.ParentUserID, Username: message.Reply.ParentUserLogin, DisplayName: message.Reply.ParentDisplayName,
			}}
		}
		handler(IncomingMessage{
			ID: message.ID, Channel: message.Channel, Text: message.Message, Timestamp: message.Time, Action: message.Action,
			Author: Author{ID: message.User.ID, Username: message.User.Name, DisplayName: message.User.DisplayName, Color: message.User.Color, Badges: badges},
			Emotes: emotes, Reply: reply,
		})
	})
}

func (c *ircClient) OnNotice(handler func(Notice)) {
	c.client.OnNoticeMessage(func(notice twitchirc.NoticeMessage) {
		handler(Notice{Channel: notice.Channel, MsgID: notice.MsgID, Message: notice.Message})
	})
}

func (c *ircClient) Join(channel string)   { c.client.Join(channel) }
func (c *ircClient) Depart(channel string) { c.client.Depart(channel) }
func (c *ircClient) Say(channel, text string) {
	log.Printf("twitch chat: IRC write PRIVMSG channel=%s bytes=%d", normalizeChannel(channel), len(text))
	c.client.Say(channel, text)
}
func (c *ircClient) Reply(channel, parentID, text string) { c.client.Reply(channel, parentID, text) }
func (c *ircClient) Connect() error                       { return c.client.Connect() }
func (c *ircClient) Disconnect() error                    { return c.client.Disconnect() }
