// Package watched owns the runtime lifecycle of persisted watched channels.
//
// Platform chat transports are intentionally shared per platform. This manager
// keeps the persistent watched-channel identity separate from that transport
// identity, so the Vue tab for a channel receives only its own statuses and
// messages.
package watched

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

const messageSnapshotLimit = 200

// Chat is the platform-neutral chat lifecycle used for a watched channel.
type Chat interface {
	Join(context.Context, string) error
	Leave(context.Context, string) error
	Send(context.Context, string, string, string) error
}

// Events keeps Wails event publishing outside of the manager and makes the
// routing rules testable without a native application.
type Events interface {
	EmitChatMessage(contracts.NormalizedChatMessage) bool
	EmitChatModeration(contracts.ModerationOutcome) bool
	EmitPlatformStatus(contracts.PlatformStatusInfo) bool
	EmitWatchedChannelMessage(contracts.WatchedChannelMessage) bool
	EmitWatchedChannelStatus(contracts.WatchedChannelStatus) bool
}

type Config struct {
	Storage *storage.Storage
	Events  Events
	Chats   map[contracts.Platform]Chat
}

// Manager restores every watched channel, starts its platform transport and
// fans incoming events out to the exact watched tab(s) that match it.
type Manager struct {
	storage *storage.Storage
	events  Events
	chats   map[contracts.Platform]Chat

	mu       sync.RWMutex
	channels map[string]contracts.WatchedChannel
	statuses map[string]contracts.PlatformStatusInfo
	started  bool
}

func NewManager(config Config) (*Manager, error) {
	if config.Storage == nil {
		return nil, errors.New("create watched manager: storage is required")
	}
	if config.Events == nil {
		return nil, errors.New("create watched manager: events are required")
	}
	return &Manager{
		storage:  config.Storage,
		events:   config.Events,
		chats:    cloneChats(config.Chats),
		channels: make(map[string]contracts.WatchedChannel),
		statuses: make(map[string]contracts.PlatformStatusInfo),
	}, nil
}

func (m *Manager) Start(ctx context.Context) error {
	m.mu.Lock()
	if m.started {
		m.mu.Unlock()
		return errors.New("watched manager has already started")
	}
	m.started = true
	m.mu.Unlock()

	channels, err := m.storage.ListWatchedChannels(ctx)
	if err != nil {
		return fmt.Errorf("restore watched channels: %w", err)
	}
	slog.Info("restore watched channels", "count", len(channels))
	for _, channel := range channels {
		m.remember(channel)
		m.connect(ctx, channel, "restore")
	}
	return nil
}

func (m *Manager) Stop(context.Context) error {
	m.mu.Lock()
	m.started = false
	m.statuses = make(map[string]contracts.PlatformStatusInfo)
	m.mu.Unlock()
	return nil
}

// SetChat wires a platform transport before Start. Composition happens in the
// main package because transports publish their events back through Manager.
func (m *Manager) SetChat(platform contracts.Platform, chat Chat) error {
	if chat == nil {
		return fmt.Errorf("set watched chat for %s: chat is required", platform)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.started {
		return errors.New("set watched chat: manager has already started")
	}
	m.chats[platform] = chat
	return nil
}

// Add persists a watched channel and starts its matching platform transport.
// A transport error is surfaced as a watched error status while retaining the
// channel: the user can inspect the error and the manager can retry on restart.
func (m *Manager) Add(
	ctx context.Context,
	platform contracts.Platform,
	channelSlug string,
) (contracts.WatchedChannel, error) {
	slug := normalize(channelSlug)
	if slug == "" {
		return contracts.WatchedChannel{}, errors.New("add watched channel: channel slug is required")
	}
	channel, err := m.storage.UpsertWatchedChannel(ctx, platform, slug, slug)
	if err != nil {
		return contracts.WatchedChannel{}, fmt.Errorf("add watched channel %q: %w", slug, err)
	}
	m.remember(channel)
	slog.Info("add watched channel", "id", channel.ID, "platform", channel.Platform, "slug", channel.ChannelSlug)
	m.connect(ctx, channel, "add")
	return channel, nil
}

func (m *Manager) Remove(ctx context.Context, id string) error {
	m.mu.RLock()
	channel, found := m.channels[id]
	m.mu.RUnlock()
	if !found {
		stored, err := m.storage.WatchedChannel(ctx, id)
		if err != nil {
			return err
		}
		if stored == nil {
			return fmt.Errorf("remove watched channel: channel %q was not found", id)
		}
		channel = *stored
	}
	if err := m.storage.DeleteWatchedChannel(ctx, id); err != nil {
		return err
	}
	if err := m.storage.DeleteWatchedLayout(ctx, id); err != nil {
		return err
	}
	m.mu.Lock()
	delete(m.channels, id)
	delete(m.statuses, id)
	m.mu.Unlock()
	if chat := m.chatFor(channel.Platform); chat != nil && !m.hasChannel(channel.Platform, channel.ChannelSlug) {
		if err := chat.Leave(ctx, channel.ChannelSlug); err != nil {
			return fmt.Errorf("leave %s watched channel %q: %w", channel.Platform, channel.ChannelSlug, err)
		}
	}
	slog.Info("remove watched channel", "id", channel.ID, "platform", channel.Platform, "slug", channel.ChannelSlug)
	return nil
}

func (m *Manager) Send(ctx context.Context, id, text, replyToMessageID string) error {
	m.mu.RLock()
	channel, found := m.channels[id]
	m.mu.RUnlock()
	if !found {
		return fmt.Errorf("send watched message: channel %q was not found", id)
	}
	chat := m.chatFor(channel.Platform)
	if chat == nil {
		return fmt.Errorf("send watched message: platform %q is not available", channel.Platform)
	}
	slog.Info("send watched message", "id", id, "platform", channel.Platform, "slug", channel.ChannelSlug)
	return chat.Send(ctx, channel.ChannelSlug, text, replyToMessageID)
}

// Statuses returns the current state for every restored watched channel.
func (m *Manager) Statuses() []contracts.WatchedChannelStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]contracts.WatchedChannelStatus, 0, len(m.statuses))
	for id, status := range m.statuses {
		result = append(result, contracts.WatchedChannelStatus{ChannelID: id, Status: status})
	}
	return result
}

// Messages returns the persisted recent history belonging to one watched tab.
func (m *Manager) Messages(ctx context.Context, id string) ([]contracts.NormalizedChatMessage, error) {
	m.mu.RLock()
	channel, found := m.channels[id]
	m.mu.RUnlock()
	if !found {
		return nil, fmt.Errorf("get watched messages: channel %q was not found", id)
	}
	messages, err := m.storage.RecentMessages(ctx, messageSnapshotLimit)
	if err != nil {
		return nil, err
	}
	matching := make([]contracts.NormalizedChatMessage, 0)
	for _, message := range messages {
		if message.Platform == channel.Platform && normalize(message.ChannelID) == channel.ChannelSlug {
			matching = append(matching, message)
		}
	}
	return matching, nil
}

// Message is passed to the underlying Twitch/Kick services as their event sink.
func (m *Manager) Message(message contracts.NormalizedChatMessage) {
	m.events.EmitChatMessage(message)
	for _, channel := range m.matching(message.Platform, message.ChannelID) {
		m.events.EmitWatchedChannelMessage(contracts.WatchedChannelMessage{ChannelID: channel.ID, Message: message})
	}
}

// Moderation is passed to platform services as their live moderation-action
// sink. The frontend resolves the outcome against its visible messages.
func (m *Manager) Moderation(outcome contracts.ModerationOutcome) {
	m.events.EmitChatModeration(outcome)
}

// Status is passed to the underlying Twitch/Kick services as their event sink.
func (m *Manager) Status(status contracts.PlatformStatusInfo) {
	m.events.EmitPlatformStatus(status)
	for _, channel := range m.matching(status.Platform, status.ChannelLogin) {
		m.mu.Lock()
		m.statuses[channel.ID] = status
		m.mu.Unlock()
		m.events.EmitWatchedChannelStatus(contracts.WatchedChannelStatus{ChannelID: channel.ID, Status: status})
	}
}

func (m *Manager) connect(ctx context.Context, channel contracts.WatchedChannel, reason string) {
	chat := m.chatFor(channel.Platform)
	if chat == nil {
		failure := fmt.Sprintf("%s chat is not available in this build", channel.Platform)
		slog.Error(
			"watched channel connection failed",
			"reason", reason,
			"id", channel.ID,
			"platform", channel.Platform,
			"slug", channel.ChannelSlug,
			"error", failure,
		)
		m.publishStatus(channel, "error", failure)
		return
	}
	slog.Info(
		"connect watched channel",
		"reason", reason,
		"id", channel.ID,
		"platform", channel.Platform,
		"slug", channel.ChannelSlug,
	)
	if err := chat.Join(ctx, channel.ChannelSlug); err != nil {
		slog.Error(
			"watched channel connection failed",
			"reason", reason,
			"id", channel.ID,
			"platform", channel.Platform,
			"slug", channel.ChannelSlug,
			"error", err,
		)
		m.publishStatus(channel, "error", err.Error())
	}
}

func (m *Manager) publishStatus(channel contracts.WatchedChannel, state, failure string) {
	status := contracts.PlatformStatusInfo{
		Platform: channel.Platform, ChannelLogin: channel.ChannelSlug, Status: state, Mode: "authenticated", Error: failure,
	}
	m.mu.Lock()
	m.statuses[channel.ID] = status
	m.mu.Unlock()
	m.events.EmitWatchedChannelStatus(contracts.WatchedChannelStatus{ChannelID: channel.ID, Status: status})
}

func (m *Manager) matching(platform contracts.Platform, slug string) []contracts.WatchedChannel {
	slug = normalize(slug)
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]contracts.WatchedChannel, 0, 1)
	for _, channel := range m.channels {
		if channel.Platform == platform && channel.ChannelSlug == slug {
			result = append(result, channel)
		}
	}
	return result
}

func (m *Manager) remember(channel contracts.WatchedChannel) {
	m.mu.Lock()
	m.channels[channel.ID] = channel
	m.mu.Unlock()
}

func (m *Manager) hasChannel(platform contracts.Platform, slug string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, channel := range m.channels {
		if channel.Platform == platform && channel.ChannelSlug == normalize(slug) {
			return true
		}
	}
	return false
}

func (m *Manager) chatFor(platform contracts.Platform) Chat {
	return m.chats[platform]
}

func cloneChats(chats map[contracts.Platform]Chat) map[contracts.Platform]Chat {
	cloned := make(map[contracts.Platform]Chat, len(chats))
	for platform, chat := range chats {
		cloned[platform] = chat
	}
	return cloned
}

func normalize(channel string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(channel), "#"))
}
