package storage

import (
	"context"
	"database/sql"
	"fmt"
)

func createSchema(ctx context.Context, db *sql.DB) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS client_identity (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS accounts (
			id TEXT PRIMARY KEY,
			platform TEXT NOT NULL,
			platform_user_id TEXT NOT NULL,
			username TEXT NOT NULL,
			display_name TEXT NOT NULL,
			avatar_url TEXT,
			access_token TEXT NOT NULL,
			refresh_token TEXT,
			expires_at INTEGER,
			scopes_json TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value_json TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS chat_messages (
			id TEXT PRIMARY KEY,
			platform TEXT NOT NULL,
			channel_id TEXT NOT NULL,
			author_id TEXT NOT NULL,
			author_name TEXT NOT NULL,
			text TEXT NOT NULL,
			type TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			data_json TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_chat_messages_user_history
			ON chat_messages(platform, author_id, created_at DESC, id DESC)`,
		`CREATE TABLE IF NOT EXISTS channel_connections (
			platform TEXT NOT NULL,
			channel_slug TEXT NOT NULL,
			PRIMARY KEY (platform, channel_slug)
		)`,
		`CREATE TABLE IF NOT EXISTS user_aliases (
			platform TEXT NOT NULL,
			platform_user_id TEXT NOT NULL,
			alias TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (platform, platform_user_id)
		)`,
		`CREATE TABLE IF NOT EXISTS watched_channels (
			id TEXT PRIMARY KEY,
			platform TEXT NOT NULL,
			channel_slug TEXT NOT NULL,
			display_name TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			UNIQUE (platform, channel_slug)
		)`,
		`CREATE TABLE IF NOT EXISTS watched_channel_layouts (
			tab_id TEXT PRIMARY KEY,
			data_json TEXT NOT NULL
		)`,
	}

	for _, statement := range statements {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("initialize storage schema: %w", err)
		}
	}
	return nil
}
