package auth

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

type recordingBrowser struct{ url string }

func (b *recordingBrowser) OpenURL(url string) error {
	b.url = url
	return nil
}

type staticIdentityResolver struct{ account contracts.Account }

func (r staticIdentityResolver) Resolve(
	_ context.Context,
	_ contracts.Platform,
	_ string,
	_ []string,
) (contracts.Account, error) {
	return r.account, nil
}

func TestServiceBeginsOAuthAndCallbackPersistsAccount(t *testing.T) {
	states := make(chan string, 1)
	successes := make(chan contracts.AuthSuccess, 1)
	backendServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/api/auth/twitch/start" {
			var body struct {
				CodeChallenge string `json:"codeChallenge"`
				State         string `json:"state"`
				RedirectURI   string `json:"redirectUri"`
			}
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatalf("decode start request: %v", err)
			}
			if body.CodeChallenge == "" || body.State == "" || body.RedirectURI == "" {
				t.Fatalf("incomplete start request: %+v", body)
			}
			states <- body.State
			_, _ = writer.Write([]byte(`{"url":"https://id.example.test/authorize"}`))
			return
		}
		if request.URL.Path == "/api/auth/twitch/exchange" {
			_, _ = writer.Write([]byte(`{"accessToken":"access","refreshToken":"refresh","expiresIn":3600,"scope":["chat:read"]}`))
			return
		}
		http.NotFound(writer, request)
	}))
	t.Cleanup(backendServer.Close)

	store, err := storage.Open(context.Background(), t.TempDir(), storage.WithMachineID("test-machine"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	client, err := backend.NewHTTPClient(backendServer.URL, "desktop-secret", backendServer.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	browser := &recordingBrowser{}
	service, err := NewService(Config{
		Address:          "127.0.0.1:0",
		Backend:          client,
		Browser:          browser,
		IdentityResolver: staticIdentityResolver{account: contracts.Account{ID: "twitch:42", Platform: contracts.PlatformTwitch, PlatformUserID: "42", Username: "streamer", DisplayName: "Streamer"}},
		Storage:          store,
		Events: Events{OnAuthSuccess: func(event contracts.AuthSuccess) {
			successes <- event
		}},
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	if err := service.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() { _ = service.Stop(context.Background()) })

	if err := service.Begin(context.Background(), contracts.PlatformTwitch); err != nil {
		t.Fatalf("Begin() error = %v", err)
	}
	if browser.url != "https://id.example.test/authorize" {
		t.Errorf("browser URL = %q", browser.url)
	}
	state := <-states
	response, err := http.Get(service.CallbackURL(contracts.PlatformTwitch) + "?code=authorization-code&state=" + state)
	if err != nil {
		t.Fatalf("callback request: %v", err)
	}
	defer response.Body.Close()
	if got, want := response.StatusCode, http.StatusOK; got != want {
		t.Errorf("callback status = %d, want %d", got, want)
	}
	tokens, found, err := store.AccountTokens(context.Background(), "twitch:42")
	if err != nil || !found {
		t.Fatalf("AccountTokens() = found %t, error %v", found, err)
	}
	if tokens.AccessToken != "access" || tokens.RefreshToken == nil || *tokens.RefreshToken != "refresh" {
		t.Errorf("stored tokens = %+v", tokens)
	}
	select {
	case success := <-successes:
		if got, want := success.Username, "streamer"; got != want {
			t.Errorf("auth success username = %q, want %q", got, want)
		}
	case <-time.After(time.Second):
		t.Fatal("successful callback did not publish auth_success")
	}
}

func TestServiceRejectsExpiredOrUnknownOAuthState(t *testing.T) {
	store, err := storage.Open(context.Background(), t.TempDir(), storage.WithMachineID("test-machine"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	client, err := backend.NewHTTPClient("https://backend.example.test", "desktop-secret", nil)
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	service, err := NewService(Config{
		Address:          "127.0.0.1:0",
		Backend:          client,
		Browser:          &recordingBrowser{},
		IdentityResolver: staticIdentityResolver{},
		SessionTTL:       time.Nanosecond,
		Storage:          store,
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	if err := service.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() { _ = service.Stop(context.Background()) })
	service.sessions["expired"] = session{platform: contracts.PlatformTwitch, expiresAt: time.Now().Add(-time.Second)}
	response, err := http.Get(service.CallbackURL(contracts.PlatformTwitch) + "?code=code&state=expired")
	if err != nil {
		t.Fatalf("callback request: %v", err)
	}
	defer response.Body.Close()
	if got, want := response.StatusCode, http.StatusBadRequest; got != want {
		t.Errorf("callback status = %d, want %d", got, want)
	}
}

func TestCallbackURLUsesConfiguredPublicLoopbackHost(t *testing.T) {
	store, err := storage.Open(context.Background(), t.TempDir(), storage.WithMachineID("test-machine"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	client, err := backend.NewHTTPClient("https://backend.example.test", "desktop-secret", nil)
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	service, err := NewService(Config{
		Address:          "127.0.0.1:0",
		CallbackHost:     "localhost",
		Backend:          client,
		Browser:          &recordingBrowser{},
		IdentityResolver: staticIdentityResolver{},
		Storage:          store,
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	if err := service.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() { _ = service.Stop(context.Background()) })

	callbackURL := service.CallbackURL(contracts.PlatformTwitch)
	if got, want := callbackURL[:len("http://localhost:")], "http://localhost:"; got != want {
		t.Errorf("CallbackURL() = %q, want host prefix %q", callbackURL, want)
	}
}

func TestServiceRefreshesAndPersistsProviderTokens(t *testing.T) {
	backendServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if got, want := request.URL.Path, "/api/auth/kick/refresh"; got != want {
			t.Errorf("path = %q, want %q", got, want)
		}
		_, _ = writer.Write([]byte(`{"accessToken":"new-access","refreshToken":"new-refresh","expiresIn":7200}`))
	}))
	t.Cleanup(backendServer.Close)
	store, err := storage.Open(context.Background(), t.TempDir(), storage.WithMachineID("test-machine"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	oldRefresh := "old-refresh"
	if err := store.UpsertAccount(context.Background(), contracts.Account{ID: "kick:7", Platform: contracts.PlatformKick, PlatformUserID: "7", Username: "streamer", DisplayName: "Streamer"}, storage.AccountTokens{AccessToken: "old-access", RefreshToken: &oldRefresh}); err != nil {
		t.Fatalf("UpsertAccount() error = %v", err)
	}
	client, err := backend.NewHTTPClient(backendServer.URL, "desktop-secret", backendServer.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	service, err := NewService(Config{Address: "127.0.0.1:0", Backend: client, Browser: &recordingBrowser{}, IdentityResolver: staticIdentityResolver{}, Storage: store})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	if err := service.Refresh(context.Background(), "kick:7"); err != nil {
		t.Fatalf("Refresh() error = %v", err)
	}
	tokens, found, err := store.AccountTokens(context.Background(), "kick:7")
	if err != nil || !found {
		t.Fatalf("AccountTokens() = found %t, error %v", found, err)
	}
	if tokens.AccessToken != "new-access" || tokens.RefreshToken == nil || *tokens.RefreshToken != "new-refresh" {
		t.Errorf("tokens = %+v, want refreshed values", tokens)
	}
}
