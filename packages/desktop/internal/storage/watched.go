package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

// UpsertWatchedChannel creates a watched channel or updates its display name.
func (s *Storage) UpsertWatchedChannel(
	ctx context.Context,
	platform contracts.Platform,
	channelSlug string,
	displayName string,
) (contracts.WatchedChannel, error) {
	slug := strings.ToLower(channelSlug)
	existing, err := scanWatchedChannel(s.db.QueryRowContext(ctx, `
		SELECT id, platform, channel_slug, display_name, created_at
		FROM watched_channels
		WHERE platform = ? AND channel_slug = ?`, platform, slug))
	if err == nil {
		if _, err := s.db.ExecContext(
			ctx,
			"UPDATE watched_channels SET display_name = ? WHERE id = ?",
			displayName,
			existing.ID,
		); err != nil {
			return contracts.WatchedChannel{}, fmt.Errorf("update watched channel %q: %w", slug, err)
		}
		existing.DisplayName = displayName
		return existing, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return contracts.WatchedChannel{}, fmt.Errorf("find watched channel %q: %w", slug, err)
	}

	id, err := newUUID()
	if err != nil {
		return contracts.WatchedChannel{}, fmt.Errorf("create watched channel %q: generate ID: %w", slug, err)
	}
	channel := contracts.WatchedChannel{
		ID:          id,
		Platform:    platform,
		ChannelSlug: slug,
		DisplayName: displayName,
		CreatedAt:   time.Now().Unix(),
	}
	if _, err := s.db.ExecContext(
		ctx,
		`INSERT INTO watched_channels (id, platform, channel_slug, display_name, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		channel.ID,
		channel.Platform,
		channel.ChannelSlug,
		channel.DisplayName,
		channel.CreatedAt,
	); err != nil {
		return contracts.WatchedChannel{}, fmt.Errorf("create watched channel %q: %w", slug, err)
	}
	return channel, nil
}

// ListWatchedChannels returns watched channels in creation order.
func (s *Storage) ListWatchedChannels(ctx context.Context) ([]contracts.WatchedChannel, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, platform, channel_slug, display_name, created_at
		FROM watched_channels
		ORDER BY created_at, id`)
	if err != nil {
		return nil, fmt.Errorf("list watched channels: %w", err)
	}
	defer rows.Close()

	channels := make([]contracts.WatchedChannel, 0)
	for rows.Next() {
		channel, err := scanWatchedChannel(rows)
		if err != nil {
			return nil, err
		}
		channels = append(channels, channel)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list watched channels: iterate rows: %w", err)
	}
	return channels, nil
}

// WatchedChannel returns one watched channel by persistent ID.
func (s *Storage) WatchedChannel(ctx context.Context, id string) (*contracts.WatchedChannel, error) {
	channel, err := scanWatchedChannel(s.db.QueryRowContext(ctx, `
		SELECT id, platform, channel_slug, display_name, created_at
		FROM watched_channels
		WHERE id = ?`, id))
	if err == nil {
		return &channel, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return nil, fmt.Errorf("get watched channel %q: %w", id, err)
}

// DeleteWatchedChannel removes a watched channel by persistent ID.
func (s *Storage) DeleteWatchedChannel(ctx context.Context, id string) error {
	if _, err := s.db.ExecContext(ctx, "DELETE FROM watched_channels WHERE id = ?", id); err != nil {
		return fmt.Errorf("delete watched channel %q: %w", id, err)
	}
	return nil
}

// DeleteWatchedChannelByPlatformSlug removes a watched channel by its normalized identity.
func (s *Storage) DeleteWatchedChannelByPlatformSlug(
	ctx context.Context,
	platform contracts.Platform,
	channelSlug string,
) error {
	if _, err := s.db.ExecContext(
		ctx,
		"DELETE FROM watched_channels WHERE platform = ? AND channel_slug = ?",
		platform,
		strings.ToLower(channelSlug),
	); err != nil {
		return fmt.Errorf("delete watched channel %q for platform %q: %w", channelSlug, platform, err)
	}
	return nil
}

// SaveWatchedLayout persists one watched-channel layout DTO as JSON.
func (s *Storage) SaveWatchedLayout(
	ctx context.Context,
	tabID string,
	layout contracts.WatchedChannelsLayout,
) error {
	now := time.Now().UnixMilli()
	meta := contracts.LayoutMeta{CreatedAt: now, UpdatedAt: now}
	if layout.Meta != nil {
		meta = *layout.Meta
		if meta.CreatedAt == 0 {
			meta.CreatedAt = now
		}
		meta.UpdatedAt = now
	}
	layout.Meta = &meta
	data, err := json.Marshal(layout)
	if err != nil {
		return fmt.Errorf("save watched layout for tab %q: encode JSON: %w", tabID, err)
	}
	if _, err := s.db.ExecContext(
		ctx,
		`INSERT INTO watched_channel_layouts (tab_id, data_json) VALUES (?, ?)
		 ON CONFLICT(tab_id) DO UPDATE SET data_json = excluded.data_json`,
		tabID,
		string(data),
	); err != nil {
		return fmt.Errorf("save watched layout for tab %q: %w", tabID, err)
	}
	return nil
}

// LoadWatchedLayout returns one watched-channel layout DTO when it is present.
func (s *Storage) LoadWatchedLayout(
	ctx context.Context,
	tabID string,
) (contracts.WatchedChannelsLayout, bool, error) {
	var data string
	err := s.db.QueryRowContext(
		ctx,
		"SELECT data_json FROM watched_channel_layouts WHERE tab_id = ?",
		tabID,
	).Scan(&data)
	if err == sql.ErrNoRows {
		return contracts.WatchedChannelsLayout{}, false, nil
	}
	if err != nil {
		return contracts.WatchedChannelsLayout{}, false, fmt.Errorf("load watched layout for tab %q: %w", tabID, err)
	}

	var layout contracts.WatchedChannelsLayout
	if err := json.Unmarshal([]byte(data), &layout); err != nil {
		return contracts.WatchedChannelsLayout{}, false, fmt.Errorf("load watched layout for tab %q: decode JSON: %w", tabID, err)
	}
	return layout, true, nil
}

// DeleteWatchedLayout removes a watched-channel layout by tab ID.
func (s *Storage) DeleteWatchedLayout(ctx context.Context, tabID string) error {
	if _, err := s.db.ExecContext(
		ctx,
		"DELETE FROM watched_channel_layouts WHERE tab_id = ?",
		tabID,
	); err != nil {
		return fmt.Errorf("delete watched layout for tab %q: %w", tabID, err)
	}
	return nil
}

func scanWatchedChannel(scanner interface{ Scan(...any) error }) (contracts.WatchedChannel, error) {
	var channel contracts.WatchedChannel
	if err := scanner.Scan(
		&channel.ID,
		&channel.Platform,
		&channel.ChannelSlug,
		&channel.DisplayName,
		&channel.CreatedAt,
	); err != nil {
		return contracts.WatchedChannel{}, fmt.Errorf("scan watched channel: %w", err)
	}
	return channel, nil
}
