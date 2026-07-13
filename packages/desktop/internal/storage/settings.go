package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

const appSettingsKey = "app_settings"

// SaveSettings persists the frontend settings DTO as explicit JSON.
func (s *Storage) SaveSettings(ctx context.Context, settings json.RawMessage) error {
	if !json.Valid(settings) {
		return fmt.Errorf("save settings: invalid JSON")
	}
	if _, err := s.db.ExecContext(
		ctx,
		`INSERT INTO settings (key, value_json) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
		appSettingsKey,
		string(settings),
	); err != nil {
		return fmt.Errorf("save settings: %w", err)
	}
	return nil
}

// LoadSettings returns the stored frontend settings JSON when present.
func (s *Storage) LoadSettings(ctx context.Context) (json.RawMessage, bool, error) {
	return s.LoadJSONSetting(ctx, appSettingsKey)
}

// SaveJSONSetting stores a named structured preference in the settings table.
func (s *Storage) SaveJSONSetting(ctx context.Context, key string, value json.RawMessage) error {
	if key == "" {
		return fmt.Errorf("save setting: key is required")
	}
	if !json.Valid(value) {
		return fmt.Errorf("save setting %q: invalid JSON", key)
	}
	if _, err := s.db.ExecContext(
		ctx,
		`INSERT INTO settings (key, value_json) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
		key,
		string(value),
	); err != nil {
		return fmt.Errorf("save setting %q: %w", key, err)
	}
	return nil
}

// LoadJSONSetting returns a named structured preference when present.
func (s *Storage) LoadJSONSetting(ctx context.Context, key string) (json.RawMessage, bool, error) {
	if key == "" {
		return nil, false, fmt.Errorf("load setting: key is required")
	}
	var value string
	err := s.db.QueryRowContext(
		ctx,
		"SELECT value_json FROM settings WHERE key = ?",
		key,
	).Scan(&value)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("load setting %q: %w", key, err)
	}
	if !json.Valid([]byte(value)) {
		return nil, false, fmt.Errorf("load setting %q: stored value is not valid JSON", key)
	}
	return json.RawMessage(value), true, nil
}
