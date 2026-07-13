package storage

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

const (
	defaultRecentMessages = 100
	defaultHistoryPage    = 50
	maxHistoryPage        = 100
	maxStoredMessages     = 1000
)

// SaveMessage persists the normalized message DTO as JSON with indexed history fields.
func (s *Storage) SaveMessage(ctx context.Context, message contracts.NormalizedChatMessage) error {
	data, err := json.Marshal(message)
	if err != nil {
		return fmt.Errorf("save message %q: encode JSON: %w", message.ID, err)
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO chat_messages (
			id, platform, channel_id, author_id, author_name, text, type, created_at, data_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			platform = excluded.platform,
			channel_id = excluded.channel_id,
			author_id = excluded.author_id,
			author_name = excluded.author_name,
			text = excluded.text,
			type = excluded.type,
			created_at = excluded.created_at,
			data_json = excluded.data_json`,
		message.ID,
		message.Platform,
		message.ChannelID,
		message.Author.ID,
		message.Author.DisplayName,
		message.Text,
		message.Type,
		message.Timestamp.UnixMilli(),
		string(data),
	); err != nil {
		return fmt.Errorf("save message %q: %w", message.ID, err)
	}
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM chat_messages
		WHERE id IN (
			SELECT id
			FROM chat_messages
			ORDER BY created_at DESC, id DESC
			LIMIT -1 OFFSET ?
		)`, maxStoredMessages); err != nil {
		return fmt.Errorf("save message %q: trim stored messages: %w", message.ID, err)
	}
	return nil
}

// DeleteMessage removes a locally optimistic message after the chat provider
// explicitly rejects delivery. Missing messages are already reconciled.
func (s *Storage) DeleteMessage(ctx context.Context, id string) error {
	if _, err := s.db.ExecContext(ctx, "DELETE FROM chat_messages WHERE id = ?", id); err != nil {
		return fmt.Errorf("delete message %q: %w", id, err)
	}
	return nil
}

// PurgeLegacyOptimisticMessages removes only local echoes created by the old
// IRC send path. New delivery state intentionally lives in the Vue process
// until a provider event is persisted, so these rows can never be valid chat
// history.
func (s *Storage) PurgeLegacyOptimisticMessages(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, "DELETE FROM chat_messages WHERE id LIKE 'local:twitch:%'"); err != nil {
		return fmt.Errorf("purge legacy optimistic messages: %w", err)
	}
	return nil
}

// RecentMessages returns messages oldest first for direct chat rendering.
func (s *Storage) RecentMessages(ctx context.Context, limit int) ([]contracts.NormalizedChatMessage, error) {
	if limit <= 0 {
		limit = defaultRecentMessages
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT data_json
		FROM chat_messages
		ORDER BY created_at DESC, id DESC
		LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list recent messages: %w", err)
	}
	defer rows.Close()

	messages := make([]contracts.NormalizedChatMessage, 0)
	for rows.Next() {
		var data string
		if err := rows.Scan(&data); err != nil {
			return nil, fmt.Errorf("list recent messages: scan row: %w", err)
		}
		message, err := decodeMessage(data)
		if err != nil {
			return nil, fmt.Errorf("list recent messages: %w", err)
		}
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list recent messages: iterate rows: %w", err)
	}
	reverseMessages(messages)
	return messages, nil
}

// UserChatHistory returns a stable, cursor-paged message history for one user.
func (s *Storage) UserChatHistory(
	ctx context.Context,
	platform contracts.Platform,
	platformUserID string,
	limit int,
	cursor *contracts.UserChatHistoryCursor,
) (contracts.UserChatHistoryPage, error) {
	if limit == 0 {
		limit = defaultHistoryPage
	}
	if limit < 1 {
		limit = 1
	}
	if limit > maxHistoryPage {
		limit = maxHistoryPage
	}

	var cursorCreatedAt any
	var cursorID string
	if cursor != nil {
		cursorCreatedAt = cursor.CreatedAt
		cursorID = cursor.ID
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, data_json, created_at
		FROM chat_messages
		WHERE platform = ?
		  AND author_id = ?
		  AND (
			? IS NULL
			OR created_at < ?
			OR (created_at = ? AND id < ?)
		  )
		ORDER BY created_at DESC, id DESC
		LIMIT ?`,
		platform,
		platformUserID,
		cursorCreatedAt,
		cursorCreatedAt,
		cursorCreatedAt,
		cursorID,
		limit+1,
	)
	if err != nil {
		return contracts.UserChatHistoryPage{}, fmt.Errorf("get user chat history: %w", err)
	}
	defer rows.Close()

	type storedMessage struct {
		id        string
		createdAt int64
		message   contracts.NormalizedChatMessage
	}
	stored := make([]storedMessage, 0, limit+1)
	for rows.Next() {
		var entry storedMessage
		var data string
		if err := rows.Scan(&entry.id, &data, &entry.createdAt); err != nil {
			return contracts.UserChatHistoryPage{}, fmt.Errorf("get user chat history: scan row: %w", err)
		}
		message, err := decodeMessage(data)
		if err != nil {
			return contracts.UserChatHistoryPage{}, fmt.Errorf("get user chat history: %w", err)
		}
		entry.message = message
		stored = append(stored, entry)
	}
	if err := rows.Err(); err != nil {
		return contracts.UserChatHistoryPage{}, fmt.Errorf("get user chat history: iterate rows: %w", err)
	}

	page := contracts.UserChatHistoryPage{HasMore: len(stored) > limit}
	if page.HasMore {
		stored = stored[:limit]
	}
	if len(stored) == 0 {
		return page, nil
	}
	last := stored[len(stored)-1]
	page.NextCursor = &contracts.UserChatHistoryCursor{CreatedAt: last.createdAt, ID: last.id}
	page.Messages = make([]contracts.NormalizedChatMessage, len(stored))
	for index, entry := range stored {
		page.Messages[len(stored)-1-index] = entry.message
	}
	return page, nil
}

func decodeMessage(data string) (contracts.NormalizedChatMessage, error) {
	var message contracts.NormalizedChatMessage
	if err := json.Unmarshal([]byte(data), &message); err != nil {
		return contracts.NormalizedChatMessage{}, fmt.Errorf("decode message JSON: %w", err)
	}
	return message, nil
}

func reverseMessages(messages []contracts.NormalizedChatMessage) {
	for left, right := 0, len(messages)-1; left < right; left, right = left+1, right-1 {
		messages[left], messages[right] = messages[right], messages[left]
	}
}
