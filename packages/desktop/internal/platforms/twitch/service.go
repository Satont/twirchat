// Package twitch owns the authenticated Twitch IRC chat lifecycle.
package twitch

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
	twitchirc "github.com/gempir/go-twitch-irc/v4"
	"github.com/google/uuid"
)

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

// Client captures the gempir IRC operations used by the lifecycle service.
type Client interface {
	OnConnect(func())
	OnMessage(func(IncomingMessage))
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
	Storage   *storage.Storage
	Events    Events
	NewClient ClientFactory
	Badges    BadgeResolver
}

// Service reconnects saved Twitch channels, persists incoming messages and
// exposes join/leave/send operations for the Wails request bridge.
type Service struct {
	storage   *storage.Storage
	events    Events
	newClient ClientFactory
	badges    BadgeResolver

	mu          sync.Mutex
	account     *contracts.Account
	channels    map[string]struct{}
	client      Client
	connected   bool
	connecting  bool
	credentials Credentials
	statuses    map[string]contracts.PlatformStatusInfo
	ctx         context.Context
	started     bool
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
	return &Service{
		storage:   config.Storage,
		events:    config.Events,
		newClient: config.NewClient,
		badges:    config.Badges,
		channels:  make(map[string]struct{}),
		statuses:  make(map[string]contracts.PlatformStatusInfo),
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
	s.mu.Lock()
	client := s.client
	connected := s.connected
	credentials := s.credentials
	s.mu.Unlock()
	if credentials.AccessToken == "" {
		return errors.New("send Twitch message: authenticate with Twitch before sending messages")
	}
	if client == nil || !connected {
		return errors.New("send Twitch message: Twitch chat is not connected")
	}
	if replyToMessageID == "" {
		client.Say(channel, text)
	} else {
		client.Reply(channel, replyToMessageID, text)
	}
	badges := []contracts.Badge{broadcasterBadge()}
	if resolved, err := s.badges.Resolve(ctx, channel, badges); err == nil {
		badges = resolved
	}

	message := contracts.NormalizedChatMessage{
		ID:        "local:twitch:" + channel + ":" + uuid.NewString(),
		Platform:  contracts.PlatformTwitch,
		ChannelID: channel,
		Author: contracts.ChatAuthor{
			ID:          credentials.PlatformUserID,
			Username:    credentials.Username,
			DisplayName: credentials.DisplayName,
			Badges:      badges,
		},
		Text:      text,
		Emotes:    []contracts.Emote{},
		Timestamp: time.Now().UTC(),
		Type:      "message",
	}
	if message.Author.ID == "" {
		message.Author.ID = credentials.AccountID
	}
	if replyToMessageID != "" {
		message.Reply = s.replyContext(ctx, replyToMessageID)
	}
	if err := s.storage.SaveMessage(ctx, message); err != nil {
		return fmt.Errorf("persist sent Twitch message: %w", err)
	}
	s.events.Message(message)
	return nil
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
		return nil
	}
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
	if credentials.AccessToken == "" {
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
	client.OnConnect(s.onConnect)
	client.OnMessage(s.onMessage)

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
	for _, channel := range channels {
		s.emitStatus(channel, "connecting", "")
	}
	go s.runConnect(client)
	return nil
}

func (s *Service) runConnect(client Client) {
	if err := client.Connect(); err != nil {
		for _, channel := range s.channelNames() {
			s.emitStatus(channel, "error", err.Error())
		}
	}
}

func (s *Service) onConnect() {
	s.mu.Lock()
	s.connected = true
	s.connecting = false
	channels := s.channelNamesLocked()
	s.mu.Unlock()
	for _, channel := range channels {
		s.emitStatus(channel, "connected", "")
	}
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
	if err := s.storage.SaveMessage(s.serviceContext(), message); err != nil {
		s.emitStatus(message.ChannelID, "error", fmt.Sprintf("persist Twitch message: %v", err))
		return
	}
	s.events.Message(message)
}

func (s *Service) emitStatus(channel, status, failure string) {
	s.mu.Lock()
	payload := contracts.PlatformStatusInfo{
		Platform: contracts.PlatformTwitch, ChannelLogin: channel, Status: status, Mode: "authenticated", Error: failure,
	}
	s.statuses[channel] = payload
	s.mu.Unlock()
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

func (c *ircClient) Join(channel string)                  { c.client.Join(channel) }
func (c *ircClient) Depart(channel string)                { c.client.Depart(channel) }
func (c *ircClient) Say(channel, text string)             { c.client.Say(channel, text) }
func (c *ircClient) Reply(channel, parentID, text string) { c.client.Reply(channel, parentID, text) }
func (c *ircClient) Connect() error                       { return c.client.Connect() }
func (c *ircClient) Disconnect() error                    { return c.client.Disconnect() }
