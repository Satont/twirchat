package twitch

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

const chattersScope = "moderator:read:chatters"

func newChattersTestService(
	t *testing.T,
	account contracts.Account,
	tokens storage.AccountTokens,
	handler http.Handler,
) (*Service, *stubTokenRefresher, *int) {
	t.Helper()
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir(), storage.WithMachineID("twitch-chatters-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if account.ID != "" {
		if err := store.UpsertAccount(ctx, account, tokens); err != nil {
			t.Fatalf("UpsertAccount() error = %v", err)
		}
	}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		if handler != nil {
			handler.ServeHTTP(writer, request)
		}
	}))
	t.Cleanup(server.Close)
	client, err := backend.NewHTTPClient(server.URL, "client-secret", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	refresher := &stubTokenRefresher{store: store}
	service, err := NewService(Config{Storage: store, Events: &recordingEvents{}, Backend: client, Refresher: refresher})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	return service, refresher, &calls
}

func chattersAccount(scopes ...string) contracts.Account {
	return contracts.Account{
		ID: "twitch:chatters", Platform: contracts.PlatformTwitch, PlatformUserID: "moderator-1",
		Username: "moderator", Scopes: scopes,
	}
}

func TestServiceChattersRequiresAccountAndScopeBeforeBackendRequest(t *testing.T) {
	for _, testCase := range []struct {
		name    string
		account contracts.Account
		want    string
	}{
		{name: "no account", want: "authenticate with Twitch before viewing chatters"},
		{name: "missing scope", account: chattersAccount("chat:read"), want: "Reconnect Twitch to grant moderator:read:chatters."},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			service, _, calls := newChattersTestService(t, testCase.account, storage.AccountTokens{AccessToken: "token"}, nil)
			_, err := service.Chatters(context.Background(), "streamer")
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("Chatters() error = %v, want %q", err, testCase.want)
			}
			if *calls != 0 {
				t.Fatalf("backend calls = %d, want 0", *calls)
			}
		})
	}
}

func TestServiceChattersSendsCredentialsAndMapsUniqueBroadcasterAndChatters(t *testing.T) {
	account := chattersAccount(chattersScope)
	service, _, _ := newChattersTestService(t, account, storage.AccountTokens{AccessToken: "access-token"}, http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload struct {
			AccessToken      string `json:"accessToken"`
			BroadcasterLogin string `json:"broadcasterLogin"`
			ModeratorID      string `json:"moderatorId"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if payload != (struct {
			AccessToken      string `json:"accessToken"`
			BroadcasterLogin string `json:"broadcasterLogin"`
			ModeratorID      string `json:"moderatorId"`
		}{"access-token", "streamer", "moderator-1"}) {
			t.Errorf("request payload = %#v", payload)
		}
		_, _ = writer.Write([]byte(`{"broadcasterId":"100","total":999,"chatters":[{"userId":"100","userLogin":"streamer","userName":"Streamer"},{"userId":"2","userLogin":"viewer","userName":"Viewer","avatarUrl":"https://cdn.example/viewer.png"},{"userId":"2","userLogin":"viewer","userName":"Viewer","avatarUrl":"https://cdn.example/viewer.png"}]}`))
	}))
	got, err := service.Chatters(context.Background(), " #StreamER ")
	if err != nil {
		t.Fatalf("Chatters() error = %v", err)
	}
	want := contracts.WatchedChannelChatters{
		Platform: contracts.PlatformTwitch, ChannelSlug: "streamer", Total: 2,
		Groups: []contracts.ChatterGroup{
			{Role: contracts.ChatterRoleBroadcaster, Users: []contracts.ChatterUser{{UserID: "100", Username: "streamer", DisplayName: "Streamer"}}},
			{Role: contracts.ChatterRoleChatters, Users: []contracts.ChatterUser{{UserID: "2", Username: "viewer", DisplayName: "Viewer", AvatarURL: "https://cdn.example/viewer.png"}}},
		},
	}
	if got.Platform != want.Platform || got.ChannelSlug != want.ChannelSlug || got.Total != want.Total || len(got.Groups) != 2 {
		t.Fatalf("Chatters() result = %#v, want %#v", got, want)
	}
	if got.Groups[0].Role != want.Groups[0].Role || got.Groups[0].Users[0] != want.Groups[0].Users[0] || got.Groups[1].Users[0] != want.Groups[1].Users[0] {
		t.Fatalf("Chatters() groups = %#v, want %#v", got.Groups, want.Groups)
	}
}

func TestServiceChattersRefreshesProactivelyWhenTokenExpiresSoon(t *testing.T) {
	refreshToken := "refresh-token"
	expiresAt := time.Now().Add(time.Minute).Unix()
	service, refresher, _ := newChattersTestService(t, chattersAccount(chattersScope), storage.AccountTokens{
		AccessToken: "stale-token", RefreshToken: &refreshToken, ExpiresAt: &expiresAt,
	}, http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload struct {
			AccessToken string `json:"accessToken"`
		}
		_ = json.NewDecoder(request.Body).Decode(&payload)
		if payload.AccessToken != "fresh-token" {
			t.Errorf("access token = %q, want fresh-token", payload.AccessToken)
		}
		_, _ = writer.Write([]byte(`{"broadcasterId":"100","chatters":[]}`))
	}))
	if _, err := service.Chatters(context.Background(), "streamer"); err != nil {
		t.Fatalf("Chatters() error = %v", err)
	}
	if refresher.calls != 1 {
		t.Fatalf("refresher calls = %d, want 1", refresher.calls)
	}
}

func TestServiceChattersRetriesOnceAfterUnauthorized(t *testing.T) {
	refreshToken := "refresh-token"
	requests := 0
	service, refresher, _ := newChattersTestService(t, chattersAccount(chattersScope), storage.AccountTokens{
		AccessToken: "stale-token", RefreshToken: &refreshToken, ExpiresAt: ptrInt64(time.Now().Add(time.Hour).Unix()),
	}, http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests++
		var payload struct {
			AccessToken string `json:"accessToken"`
		}
		_ = json.NewDecoder(request.Body).Decode(&payload)
		if requests == 1 {
			writer.WriteHeader(http.StatusUnauthorized)
			return
		}
		if payload.AccessToken != "fresh-token" {
			t.Errorf("retry access token = %q, want fresh-token", payload.AccessToken)
		}
		_, _ = writer.Write([]byte(`{"broadcasterId":"100","chatters":[]}`))
	}))
	if _, err := service.Chatters(context.Background(), "streamer"); err != nil {
		t.Fatalf("Chatters() error = %v", err)
	}
	if requests != 2 || refresher.calls != 1 {
		t.Fatalf("requests = %d, refresher calls = %d, want 2 and 1", requests, refresher.calls)
	}
}

func TestServiceChattersKeepsBroadcasterGroupWhenBroadcasterIsAbsent(t *testing.T) {
	service, _, _ := newChattersTestService(t, chattersAccount(chattersScope), storage.AccountTokens{AccessToken: "token"}, http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"broadcasterId":"100","chatters":[{"userId":"2","userLogin":"viewer","userName":"Viewer"}]}`))
	}))
	got, err := service.Chatters(context.Background(), "streamer")
	if err != nil {
		t.Fatalf("Chatters() error = %v", err)
	}
	if len(got.Groups) != 2 || len(got.Groups[0].Users) != 0 || got.Groups[1].Users[0].UserID != "2" || got.Groups[1].Users[0].AvatarURL != "" || got.Total != 1 {
		t.Fatalf("Chatters() result = %#v, want empty broadcaster and one chatter", got)
	}
}

func TestServiceChattersMapsBackendFailuresToStableErrors(t *testing.T) {
	for _, testCase := range []struct {
		name string
		code int
		want string
	}{
		{name: "unauthorized", code: http.StatusUnauthorized, want: "Reconnect Twitch to grant moderator:read:chatters."},
		{name: "forbidden", code: http.StatusForbidden, want: "You must be a moderator or broadcaster to view this Twitch chatters list."},
		{name: "not found", code: http.StatusNotFound, want: "Twitch channel streamer was not found"},
		{name: "generic", code: http.StatusBadGateway, want: "Twitch chatters are currently unavailable."},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			service, _, _ := newChattersTestService(t, chattersAccount(chattersScope), storage.AccountTokens{AccessToken: "token"}, http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(testCase.code)
				if testCase.code == http.StatusNotFound {
					_, _ = writer.Write([]byte(`{"error":"Twitch channel streamer was not found"}`))
				}
			}))
			_, err := service.Chatters(context.Background(), "streamer")
			if err == nil || err.Error() != testCase.want {
				t.Fatalf("Chatters() error = %v, want %q", err, testCase.want)
			}
		})
	}
}

func ptrInt64(value int64) *int64 { return &value }
