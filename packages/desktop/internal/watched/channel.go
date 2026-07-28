package watched

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

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
