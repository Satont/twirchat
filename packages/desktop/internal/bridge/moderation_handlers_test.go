package bridge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

func TestRegisterModerationHandlersInjectsStoredCredentials(t *testing.T) {
	store, err := storage.Open(context.Background(), t.TempDir(), storage.WithMachineID("moderation-handler-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	account := contracts.Account{
		ID: "twitch:self", Platform: contracts.PlatformTwitch, PlatformUserID: "42",
		Username: "streamer", DisplayName: "Streamer",
		Scopes: []string{"moderator:manage:chat_messages", "moderator:manage:banned_users"},
	}
	if err := store.UpsertAccount(context.Background(), account, storage.AccountTokens{AccessToken: "secret-token"}); err != nil {
		t.Fatalf("UpsertAccount() error = %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var body struct {
			AccessToken    string   `json:"accessToken"`
			PlatformUserID string   `json:"platformUserId"`
			Scopes         []string `json:"scopes"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode backend request: %v", err)
		}
		if body.AccessToken != "secret-token" || body.PlatformUserID != "42" || len(body.Scopes) != 2 {
			t.Errorf("credentials = %#v, want stored account credentials", body)
		}
		switch request.URL.Path {
		case "/api/moderation/capabilities":
			_, _ = writer.Write([]byte(`{"canModerate":true}`))
		case "/api/moderation/action":
			_, _ = writer.Write([]byte(`{"success":true}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	t.Cleanup(server.Close)
	client, err := backend.NewHTTPClient(server.URL, "desktop-secret", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	registry := NewHandlerRegistry()
	RegisterModerationHandlers(registry, client, store, nil)
	service := NewDesktopService(registry)

	capabilities, err := service.Call(contracts.GatewayRequest{
		Method: contracts.RequestGetModerationCapabilities,
		Params: map[string]any{"platform": "twitch", "channelSlug": "streamer"},
	})
	if err != nil {
		t.Fatalf("getModerationCapabilities error = %v", err)
	}
	if !capabilities.(contracts.ModerationCapabilities).CanModerate {
		t.Error("CanModerate = false, want true")
	}

	result, err := service.Call(contracts.GatewayRequest{
		Method: contracts.RequestModerateMessage,
		Params: map[string]any{
			"platform": "twitch", "channelSlug": "streamer", "messageId": "message-id",
			"targetUserId": "7", "action": "delete_message",
		},
	})
	if err != nil {
		t.Fatalf("moderateMessage error = %v", err)
	}
	if !result.(contracts.ModerationActionResult).Success {
		t.Error("Success = false, want true")
	}
}

func TestRegisterModerationHandlersRefreshesExpiredCredentials(t *testing.T) {
	store, err := storage.Open(context.Background(), t.TempDir(), storage.WithMachineID("moderation-refresh-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	account := contracts.Account{
		ID: "kick:self", Platform: contracts.PlatformKick, PlatformUserID: "42",
		Username: "streamer", DisplayName: "Streamer",
		Scopes: []string{"moderation:chat_message:manage"},
	}
	expired := time.Now().Add(-time.Hour).Unix()
	refreshToken := "refresh"
	if err := store.UpsertAccount(context.Background(), account, storage.AccountTokens{
		AccessToken: "stale-token", RefreshToken: &refreshToken, ExpiresAt: &expired,
	}); err != nil {
		t.Fatalf("UpsertAccount() error = %v", err)
	}
	var sentToken string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var body struct {
			AccessToken string `json:"accessToken"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode backend request: %v", err)
		}
		sentToken = body.AccessToken
		_, _ = writer.Write([]byte(`{"success":true}`))
	}))
	t.Cleanup(server.Close)
	client, err := backend.NewHTTPClient(server.URL, "desktop-secret", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	refresher := &stubTokenRefresher{store: store, freshToken: "fresh-token"}
	registry := NewHandlerRegistry()
	RegisterModerationHandlers(registry, client, store, refresher)
	service := NewDesktopService(registry)

	if _, err := service.Call(contracts.GatewayRequest{
		Method: contracts.RequestModerateMessage,
		Params: map[string]any{
			"platform": "kick", "channelSlug": "streamer", "messageId": "message-id",
			"targetUserId": "7", "action": "delete_message",
		},
	}); err != nil {
		t.Fatalf("moderateMessage error = %v", err)
	}
	if refresher.calls != 1 {
		t.Errorf("refresher calls = %d, want 1", refresher.calls)
	}
	if sentToken != "fresh-token" {
		t.Errorf("access token = %q, want refreshed token", sentToken)
	}
}

type stubTokenRefresher struct {
	store      *storage.Storage
	freshToken string
	calls      int
}

func (s *stubTokenRefresher) Refresh(ctx context.Context, accountID string) error {
	s.calls++
	return s.store.UpdateAccountTokens(ctx, accountID, storage.AccountTokens{AccessToken: s.freshToken})
}
