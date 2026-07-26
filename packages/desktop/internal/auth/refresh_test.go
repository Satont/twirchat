package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

type recordingRefresher struct {
	calls int
	err   error
	store *storage.Storage
}

func (r *recordingRefresher) Refresh(ctx context.Context, accountID string) error {
	r.calls++
	if r.err != nil {
		return r.err
	}
	return r.store.UpdateAccountTokens(ctx, accountID, storage.AccountTokens{AccessToken: "fresh-token"})
}

func openTokenStore(t *testing.T) *storage.Storage {
	t.Helper()
	store, err := storage.Open(context.Background(), t.TempDir(), storage.WithMachineID("refresh-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func upsertExpiringAccount(t *testing.T, store *storage.Storage, expiresAt *int64) {
	t.Helper()
	refreshToken := "refresh-token"
	account := contracts.Account{
		ID: "kick:1", Platform: contracts.PlatformKick, PlatformUserID: "1", Username: "satont", DisplayName: "Satont",
	}
	if err := store.UpsertAccount(context.Background(), account, storage.AccountTokens{
		AccessToken: "stale-token", RefreshToken: &refreshToken, ExpiresAt: expiresAt,
	}); err != nil {
		t.Fatalf("UpsertAccount() error = %v", err)
	}
}

func TestEnsureFreshTokensSkipsRefreshForValidToken(t *testing.T) {
	store := openTokenStore(t)
	expiresAt := time.Now().Add(time.Hour).Unix()
	upsertExpiringAccount(t, store, &expiresAt)
	refresher := &recordingRefresher{store: store}
	tokens, found, err := EnsureFreshTokens(context.Background(), store, refresher, "kick:1")
	if err != nil || !found {
		t.Fatalf("EnsureFreshTokens() = found %v, err %v", found, err)
	}
	if tokens.AccessToken != "stale-token" || refresher.calls != 0 {
		t.Fatalf("token = %q, refresher calls = %d; want untouched valid token", tokens.AccessToken, refresher.calls)
	}
}

func TestEnsureFreshTokensRefreshesExpiredToken(t *testing.T) {
	store := openTokenStore(t)
	expiresAt := time.Now().Add(-time.Hour).Unix()
	upsertExpiringAccount(t, store, &expiresAt)
	refresher := &recordingRefresher{store: store}
	tokens, found, err := EnsureFreshTokens(context.Background(), store, refresher, "kick:1")
	if err != nil || !found {
		t.Fatalf("EnsureFreshTokens() = found %v, err %v", found, err)
	}
	if tokens.AccessToken != "fresh-token" || refresher.calls != 1 {
		t.Fatalf("token = %q, refresher calls = %d; want refreshed token", tokens.AccessToken, refresher.calls)
	}
}

func TestEnsureFreshTokensReturnsStaleTokenWhenRefreshFails(t *testing.T) {
	store := openTokenStore(t)
	expiresAt := time.Now().Add(-time.Hour).Unix()
	upsertExpiringAccount(t, store, &expiresAt)
	refresher := &recordingRefresher{err: errors.New("backend down"), store: store}
	tokens, found, err := EnsureFreshTokens(context.Background(), store, refresher, "kick:1")
	if err != nil || !found {
		t.Fatalf("EnsureFreshTokens() = found %v, err %v; want stale tokens without error", found, err)
	}
	if tokens.AccessToken != "stale-token" {
		t.Fatalf("token = %q, want stale token after failed refresh", tokens.AccessToken)
	}
}
