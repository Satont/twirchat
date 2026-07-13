package bridge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

func TestRegisterBackendHandlersReturnsStreamStatusForVue(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if got, want := request.URL.Path, "/api/stream-status"; got != want {
			t.Errorf("path = %q, want %q", got, want)
		}
		if got, want := request.URL.Query().Get("platform"), "twitch"; got != want {
			t.Errorf("platform = %q, want %q", got, want)
		}
		if got, want := request.URL.Query().Get("channelId"), "streamer"; got != want {
			t.Errorf("channelId = %q, want %q", got, want)
		}
		_, _ = writer.Write([]byte(`{"isLive":true,"title":"Live now","categoryId":"42","categoryName":"Games","viewerCount":15}`))
	}))
	t.Cleanup(server.Close)
	client, err := backend.NewHTTPClient(server.URL, "client-secret", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	registry := NewHandlerRegistry()
	store, err := storage.Open(context.Background(), t.TempDir(), storage.WithMachineID("backend-handler-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	RegisterBackendHandlers(registry, client, store)
	result, err := NewDesktopService(registry).Call(contracts.GatewayRequest{
		Method: contracts.RequestGetStreamStatus,
		Params: map[string]any{"platform": "twitch", "channelId": "streamer"},
	})
	if err != nil {
		t.Fatalf("getStreamStatus error = %v", err)
	}
	status := result.(contracts.StreamStatus)
	if !status.IsLive || status.Title != "Live now" || status.CategoryName != "Games" {
		t.Errorf("stream status = %#v", status)
	}
}

func TestRegisterBackendHandlersReturnsBulkChannelStatuses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if got, want := request.URL.Path, "/api/channels-status"; got != want {
			t.Errorf("path = %q, want %q", got, want)
		}
		if got, want := request.Method, http.MethodPost; got != want {
			t.Errorf("method = %q, want %q", got, want)
		}
		_, _ = writer.Write([]byte(`{"channels":[{"platform":"twitch","channelLogin":"streamer","isLive":true,"title":"Live","viewerCount":9}]}`))
	}))
	t.Cleanup(server.Close)
	store, err := storage.Open(context.Background(), t.TempDir(), storage.WithMachineID("backend-handler-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	client, err := backend.NewHTTPClient(server.URL, "client-secret", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	registry := NewHandlerRegistry()
	RegisterBackendHandlers(registry, client, store)
	result, err := NewDesktopService(registry).Call(contracts.GatewayRequest{
		Method: contracts.RequestGetChannelsStatus,
		Params: map[string]any{"channels": []map[string]any{{"platform": "twitch", "channelLogin": "streamer", "channelId": "42"}}},
	})
	if err != nil {
		t.Fatalf("getChannelsStatus error = %v", err)
	}
	response := result.(contracts.ChannelsStatusResponse)
	if got, want := len(response.Channels), 1; got != want || !response.Channels[0].IsLive {
		t.Errorf("channel statuses = %#v", response)
	}
}

func TestRegisterBackendHandlersReturnsUserCardMetadataWithStoredTwitchAuth(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if got, want := request.URL.Path, "/api/user-card-metadata"; got != want {
			t.Errorf("path = %q, want %q", got, want)
		}
		var body struct {
			Platform     string `json:"platform"`
			PlatformUser string `json:"platformUserId"`
			TwitchAuth   struct {
				AccessToken string `json:"accessToken"`
			} `json:"twitchAuth"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode user card request: %v", err)
		}
		if body.Platform != "twitch" || body.PlatformUser != "viewer" || body.TwitchAuth.AccessToken != "access-token" {
			t.Errorf("request body = %#v", body)
		}
		_, _ = writer.Write([]byte(`{"platform":"twitch","platformUserId":"viewer","fetchedAt":123,"accountAge":{"status":"available","createdAt":"2020-01-01T00:00:00Z"},"followAge":{"status":"unavailable","followedAt":null},"subscriptionDuration":{"status":"unavailable","currentlySubscribed":null},"subAge":{"status":"unavailable","months":null}}`))
	}))
	t.Cleanup(server.Close)
	store, err := storage.Open(context.Background(), t.TempDir(), storage.WithMachineID("user-card-handler-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.UpsertAccount(context.Background(), contracts.Account{ID: "twitch:self", Platform: contracts.PlatformTwitch, PlatformUserID: "self", Username: "streamer", DisplayName: "Streamer", Scopes: []string{"chat:read"}}, storage.AccountTokens{AccessToken: "access-token"}); err != nil {
		t.Fatalf("UpsertAccount() error = %v", err)
	}
	client, err := backend.NewHTTPClient(server.URL, "client-secret", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	registry := NewHandlerRegistry()
	RegisterBackendHandlers(registry, client, store)
	result, err := NewDesktopService(registry).Call(contracts.GatewayRequest{Method: contracts.RequestGetUserCardMetadata, Params: map[string]any{
		"platform": "twitch", "platformUserId": "viewer", "channelId": "streamer",
	}})
	if err != nil {
		t.Fatalf("getUserCardMetadata error = %v", err)
	}
	metadata := result.(map[string]any)
	if got, want := metadata["platformUserId"], "viewer"; got != want {
		t.Errorf("platformUserId = %#v, want %q", got, want)
	}
}
