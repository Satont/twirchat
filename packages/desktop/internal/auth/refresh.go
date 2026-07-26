package auth

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

// TokenRefresher renews expired OAuth credentials for an account.
// *Service implements it via Refresh.
type TokenRefresher interface {
	Refresh(ctx context.Context, accountID string) error
}

// refreshLeeway is how long before the stored expiry a token counts as stale.
const refreshLeeway = 5 * time.Minute

// EnsureFreshTokens returns credentials for accountID, refreshing them first
// when they are expired or expire within the leeway. A failed refresh is
// logged and the stale tokens are returned — the caller's request may still
// succeed (clock skew) and a provider 401 triggers a forced retry. Storage
// errors are returned.
func EnsureFreshTokens(
	ctx context.Context,
	store *storage.Storage,
	refresher TokenRefresher,
	accountID string,
) (storage.AccountTokens, bool, error) {
	tokens, found, err := store.AccountTokens(ctx, accountID)
	if err != nil || !found {
		return storage.AccountTokens{}, found, err
	}
	if refresher == nil || tokens.RefreshToken == nil || tokens.ExpiresAt == nil {
		return tokens, true, nil
	}
	if time.Now().Unix() < *tokens.ExpiresAt-int64(refreshLeeway.Seconds()) {
		return tokens, true, nil
	}
	if err := refresher.Refresh(ctx, accountID); err != nil {
		slog.Error("proactive OAuth token refresh failed", "account", accountID, "error", err)
		return tokens, true, nil
	}
	return ReloadTokens(ctx, store, accountID)
}

// ReloadTokens re-reads credentials after a successful refresh.
func ReloadTokens(
	ctx context.Context,
	store *storage.Storage,
	accountID string,
) (storage.AccountTokens, bool, error) {
	tokens, found, err := store.AccountTokens(ctx, accountID)
	if err != nil {
		return storage.AccountTokens{}, false, err
	}
	if !found {
		return storage.AccountTokens{}, false, fmt.Errorf("account %q lost credentials during token refresh", accountID)
	}
	return tokens, true, nil
}
