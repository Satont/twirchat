package storage

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

// SaveChannel persists a joined channel once per platform and normalized slug.
func (s *Storage) SaveChannel(ctx context.Context, platform contracts.Platform, channelSlug string) error {
	if _, err := s.db.ExecContext(
		ctx,
		"INSERT OR IGNORE INTO channel_connections (platform, channel_slug) VALUES (?, ?)",
		platform,
		strings.ToLower(channelSlug),
	); err != nil {
		return fmt.Errorf("save channel %q for platform %q: %w", channelSlug, platform, err)
	}
	return nil
}

// RemoveChannel removes a persisted joined channel.
func (s *Storage) RemoveChannel(ctx context.Context, platform contracts.Platform, channelSlug string) error {
	if _, err := s.db.ExecContext(
		ctx,
		"DELETE FROM channel_connections WHERE platform = ? AND channel_slug = ?",
		platform,
		strings.ToLower(channelSlug),
	); err != nil {
		return fmt.Errorf("remove channel %q for platform %q: %w", channelSlug, platform, err)
	}
	return nil
}

// ChannelsByPlatform returns saved channel slugs in stable order.
func (s *Storage) ChannelsByPlatform(ctx context.Context, platform contracts.Platform) ([]string, error) {
	rows, err := s.db.QueryContext(
		ctx,
		"SELECT channel_slug FROM channel_connections WHERE platform = ? ORDER BY channel_slug",
		platform,
	)
	if err != nil {
		return nil, fmt.Errorf("list channels for platform %q: %w", platform, err)
	}
	defer rows.Close()

	channels := make([]string, 0)
	for rows.Next() {
		var channel string
		if err := rows.Scan(&channel); err != nil {
			return nil, fmt.Errorf("list channels for platform %q: scan row: %w", platform, err)
		}
		channels = append(channels, channel)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list channels for platform %q: iterate rows: %w", platform, err)
	}
	return channels, nil
}

// AllChannels returns saved channels grouped by platform in stable order.
func (s *Storage) AllChannels(ctx context.Context) (map[contracts.Platform][]string, error) {
	rows, err := s.db.QueryContext(
		ctx,
		"SELECT platform, channel_slug FROM channel_connections ORDER BY platform, channel_slug",
	)
	if err != nil {
		return nil, fmt.Errorf("list all channels: %w", err)
	}
	defer rows.Close()

	channels := make(map[contracts.Platform][]string)
	for rows.Next() {
		var platform contracts.Platform
		var channel string
		if err := rows.Scan(&platform, &channel); err != nil {
			return nil, fmt.Errorf("list all channels: scan row: %w", err)
		}
		channels[platform] = append(channels[platform], channel)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list all channels: iterate rows: %w", err)
	}
	return channels, nil
}

// UpsertAlias stores the frontend user-alias DTO by platform user identity.
func (s *Storage) UpsertAlias(ctx context.Context, alias contracts.UserAlias) error {
	now := time.Now().Unix()
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO user_aliases (platform, platform_user_id, alias, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(platform, platform_user_id) DO UPDATE SET
			alias = excluded.alias,
			updated_at = excluded.updated_at`,
		alias.Platform,
		alias.PlatformUserID,
		alias.Alias,
		now,
		now,
	); err != nil {
		return fmt.Errorf("upsert alias for %q/%q: %w", alias.Platform, alias.PlatformUserID, err)
	}
	return nil
}

// ListAliases returns user aliases in stable platform and user order.
func (s *Storage) ListAliases(ctx context.Context) ([]contracts.UserAlias, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT platform, platform_user_id, alias, created_at, updated_at
		 FROM user_aliases
		 ORDER BY platform, platform_user_id`,
	)
	if err != nil {
		return nil, fmt.Errorf("list aliases: %w", err)
	}
	defer rows.Close()

	aliases := make([]contracts.UserAlias, 0)
	for rows.Next() {
		var alias contracts.UserAlias
		if err := rows.Scan(
			&alias.Platform,
			&alias.PlatformUserID,
			&alias.Alias,
			&alias.CreatedAt,
			&alias.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("list aliases: scan row: %w", err)
		}
		aliases = append(aliases, alias)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list aliases: iterate rows: %w", err)
	}
	return aliases, nil
}

// RemoveAlias removes an alias by platform user identity.
func (s *Storage) RemoveAlias(
	ctx context.Context,
	platform contracts.Platform,
	platformUserID string,
) error {
	if _, err := s.db.ExecContext(
		ctx,
		"DELETE FROM user_aliases WHERE platform = ? AND platform_user_id = ?",
		platform,
		platformUserID,
	); err != nil {
		return fmt.Errorf("remove alias for %q/%q: %w", platform, platformUserID, err)
	}
	return nil
}
