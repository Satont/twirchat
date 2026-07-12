package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

const clientSecretKey = "client_secret"

// AccountTokens contains the credentials that are stored separately from account metadata.
type AccountTokens struct {
	AccessToken  string
	RefreshToken *string
	ExpiresAt    *int64
}

// ClientSecret returns the persistent identifier used by backend requests.
func (s *Storage) ClientSecret(ctx context.Context) (string, error) {
	var secret string
	err := s.db.QueryRowContext(
		ctx,
		"SELECT value FROM client_identity WHERE key = ?",
		clientSecretKey,
	).Scan(&secret)
	if err == nil {
		return secret, nil
	}
	if err != sql.ErrNoRows {
		return "", fmt.Errorf("get client secret: %w", err)
	}

	secret, err = newUUID()
	if err != nil {
		return "", fmt.Errorf("create client secret: %w", err)
	}
	if _, err := s.db.ExecContext(
		ctx,
		"INSERT INTO client_identity (key, value) VALUES (?, ?)",
		clientSecretKey,
		secret,
	); err != nil {
		return "", fmt.Errorf("store client secret: %w", err)
	}
	return secret, nil
}

// UpsertAccount stores account metadata and encrypts each credential independently.
func (s *Storage) UpsertAccount(
	ctx context.Context,
	account contracts.Account,
	tokens AccountTokens,
) error {
	if account.ID == "" {
		return errors.New("upsert account: account ID is required")
	}
	if tokens.AccessToken == "" {
		return errors.New("upsert account: access token is required")
	}

	encryptedAccess, err := encryptValue(s.machineID, tokens.AccessToken)
	if err != nil {
		return fmt.Errorf("upsert account: encrypt access token: %w", err)
	}
	var encryptedRefresh any
	if tokens.RefreshToken != nil {
		encryptedRefresh, err = encryptValue(s.machineID, *tokens.RefreshToken)
		if err != nil {
			return fmt.Errorf("upsert account: encrypt refresh token: %w", err)
		}
	}

	scopes := account.Scopes
	if scopes == nil {
		scopes = []string{}
	}
	scopesJSON, err := json.Marshal(scopes)
	if err != nil {
		return fmt.Errorf("upsert account: encode scopes: %w", err)
	}

	now := time.Now().Unix()
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO accounts (
			id, platform, platform_user_id, username, display_name, avatar_url,
			access_token, refresh_token, expires_at, scopes_json, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			platform = excluded.platform,
			platform_user_id = excluded.platform_user_id,
			username = excluded.username,
			display_name = excluded.display_name,
			avatar_url = excluded.avatar_url,
			access_token = excluded.access_token,
			refresh_token = excluded.refresh_token,
			expires_at = excluded.expires_at,
			scopes_json = excluded.scopes_json,
			updated_at = excluded.updated_at`,
		account.ID,
		account.Platform,
		account.PlatformUserID,
		account.Username,
		account.DisplayName,
		nullableString(account.AvatarURL),
		encryptedAccess,
		encryptedRefresh,
		tokens.ExpiresAt,
		string(scopesJSON),
		now,
		now,
	); err != nil {
		return fmt.Errorf("upsert account %q: %w", account.ID, err)
	}
	return nil
}

// ListAccounts returns the metadata-only account DTOs expected by the frontend.
func (s *Storage) ListAccounts(ctx context.Context) ([]contracts.Account, error) {
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("list accounts: context: %w", err)
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, platform, platform_user_id, username, display_name, avatar_url,
		       scopes_json, created_at, updated_at
		FROM accounts
		ORDER BY created_at, id`)
	if err != nil {
		return nil, fmt.Errorf("list accounts: %w", err)
	}
	defer rows.Close()

	accounts := make([]contracts.Account, 0)
	for rows.Next() {
		account, err := scanAccount(rows)
		if err != nil {
			return nil, err
		}
		accounts = append(accounts, account)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list accounts: iterate rows: %w", err)
	}
	return accounts, nil
}

// FindAccountByPlatform returns the first account connected to a platform.
func (s *Storage) FindAccountByPlatform(
	ctx context.Context,
	platform contracts.Platform,
) (*contracts.Account, error) {
	account, err := scanAccount(s.db.QueryRowContext(ctx, `
		SELECT id, platform, platform_user_id, username, display_name, avatar_url,
		       scopes_json, created_at, updated_at
		FROM accounts
		WHERE platform = ?
		ORDER BY created_at, id
		LIMIT 1`, platform))
	if err == nil {
		return &account, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return nil, fmt.Errorf("find account for platform %q: %w", platform, err)
}

// AccountByID returns one account's metadata without exposing its credentials.
func (s *Storage) AccountByID(ctx context.Context, accountID string) (*contracts.Account, error) {
	account, err := scanAccount(s.db.QueryRowContext(ctx, `
		SELECT id, platform, platform_user_id, username, display_name, avatar_url,
		       scopes_json, created_at, updated_at
		FROM accounts
		WHERE id = ?`, accountID))
	if err == nil {
		return &account, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return nil, fmt.Errorf("find account %q: %w", accountID, err)
}

// AccountTokens returns the decrypted credentials for an account when it exists.
func (s *Storage) AccountTokens(ctx context.Context, accountID string) (AccountTokens, bool, error) {
	var encryptedAccess string
	var encryptedRefresh sql.NullString
	var expiresAt sql.NullInt64
	err := s.db.QueryRowContext(
		ctx,
		"SELECT access_token, refresh_token, expires_at FROM accounts WHERE id = ?",
		accountID,
	).Scan(&encryptedAccess, &encryptedRefresh, &expiresAt)
	if err == sql.ErrNoRows {
		return AccountTokens{}, false, nil
	}
	if err != nil {
		return AccountTokens{}, false, fmt.Errorf("get account tokens for %q: %w", accountID, err)
	}

	accessToken, err := decryptValue(s.machineID, encryptedAccess)
	if err != nil {
		return AccountTokens{}, false, fmt.Errorf("get account tokens for %q: decrypt access token: %w", accountID, err)
	}
	tokens := AccountTokens{AccessToken: accessToken}
	if encryptedRefresh.Valid {
		refreshToken, err := decryptValue(s.machineID, encryptedRefresh.String)
		if err != nil {
			return AccountTokens{}, false, fmt.Errorf("get account tokens for %q: decrypt refresh token: %w", accountID, err)
		}
		tokens.RefreshToken = &refreshToken
	}
	if expiresAt.Valid {
		tokens.ExpiresAt = &expiresAt.Int64
	}
	return tokens, true, nil
}

// UpdateAccountTokens replaces credentials while retaining account metadata.
func (s *Storage) UpdateAccountTokens(ctx context.Context, accountID string, tokens AccountTokens) error {
	if tokens.AccessToken == "" {
		return errors.New("update account tokens: access token is required")
	}
	encryptedAccess, err := encryptValue(s.machineID, tokens.AccessToken)
	if err != nil {
		return fmt.Errorf("update account tokens: encrypt access token: %w", err)
	}
	var encryptedRefresh any
	if tokens.RefreshToken != nil {
		encryptedRefresh, err = encryptValue(s.machineID, *tokens.RefreshToken)
		if err != nil {
			return fmt.Errorf("update account tokens: encrypt refresh token: %w", err)
		}
	}

	result, err := s.db.ExecContext(
		ctx,
		`UPDATE accounts
		 SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ?
		 WHERE id = ?`,
		encryptedAccess,
		encryptedRefresh,
		tokens.ExpiresAt,
		time.Now().Unix(),
		accountID,
	)
	if err != nil {
		return fmt.Errorf("update account tokens for %q: %w", accountID, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("update account tokens for %q: get affected rows: %w", accountID, err)
	}
	if affected == 0 {
		return fmt.Errorf("update account tokens for %q: account not found", accountID)
	}
	return nil
}

// DeleteAccount removes one persisted account and its credentials.
func (s *Storage) DeleteAccount(ctx context.Context, accountID string) error {
	if _, err := s.db.ExecContext(ctx, "DELETE FROM accounts WHERE id = ?", accountID); err != nil {
		return fmt.Errorf("delete account %q: %w", accountID, err)
	}
	return nil
}

// DeleteAccountsByPlatform removes every account connected to a platform.
func (s *Storage) DeleteAccountsByPlatform(ctx context.Context, platform contracts.Platform) error {
	if _, err := s.db.ExecContext(ctx, "DELETE FROM accounts WHERE platform = ?", platform); err != nil {
		return fmt.Errorf("delete accounts for platform %q: %w", platform, err)
	}
	return nil
}

func scanAccount(scanner interface{ Scan(...any) error }) (contracts.Account, error) {
	var account contracts.Account
	var avatarURL sql.NullString
	var scopesJSON string
	if err := scanner.Scan(
		&account.ID,
		&account.Platform,
		&account.PlatformUserID,
		&account.Username,
		&account.DisplayName,
		&avatarURL,
		&scopesJSON,
		&account.CreatedAt,
		&account.UpdatedAt,
	); err != nil {
		return contracts.Account{}, fmt.Errorf("scan account: %w", err)
	}
	if avatarURL.Valid {
		account.AvatarURL = avatarURL.String
	}
	if err := json.Unmarshal([]byte(scopesJSON), &account.Scopes); err != nil {
		return contracts.Account{}, fmt.Errorf("decode account %q scopes: %w", account.ID, err)
	}
	if account.Scopes == nil {
		account.Scopes = []string{}
	}
	return account, nil
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func newUUID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = value[6]&0x0f | 0x40
	value[8] = value[8]&0x3f | 0x80

	return fmt.Sprintf(
		"%08x-%04x-%04x-%04x-%012x",
		value[0:4],
		value[4:6],
		value[6:8],
		value[8:10],
		value[10:16],
	), nil
}
