package kick

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

type recordingEvents struct {
	statuses []contracts.PlatformStatusInfo
}

func (e *recordingEvents) Status(status contracts.PlatformStatusInfo) {
	e.statuses = append(e.statuses, status)
}

func (e *recordingEvents) Message(contracts.NormalizedChatMessage) {}

func TestServiceStartsSavedKickChannelAndSendsWithAccountToken(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir(), storage.WithMachineID("kick-service-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.UpsertAccount(ctx, contracts.Account{ID: "kick:1", Platform: contracts.PlatformKick, PlatformUserID: "1", Username: "satont", DisplayName: "Satont"}, storage.AccountTokens{AccessToken: "kick-token"}); err != nil {
		t.Fatalf("UpsertAccount() error = %v", err)
	}
	if err := store.SaveChannel(ctx, contracts.PlatformKick, "satont"); err != nil {
		t.Fatalf("SaveChannel() error = %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/kick/chatroom":
			_, _ = w.Write([]byte(`{"chatroomId":44,"broadcasterUserId":1}`))
		case "/chat":
			if got, want := r.Header.Get("Authorization"), "Bearer kick-token"; got != want {
				t.Errorf("Authorization = %q, want %q", got, want)
			}
			_, _ = w.Write([]byte(`{}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	backendClient, err := backend.NewHTTPClient(server.URL, "secret", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	events := &recordingEvents{}
	service, err := NewService(Config{Storage: store, Events: events, Backend: backendClient, ChatAPIURL: server.URL + "/chat"})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	if err := service.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if got := events.statuses[len(events.statuses)-1]; got.Platform != contracts.PlatformKick || got.Status != "connected" || got.ChannelLogin != "satont" {
		t.Fatalf("status = %#v", got)
	}
	if err := service.Send(ctx, "satont", "hello", ""); err != nil {
		t.Fatalf("Send() error = %v", err)
	}
}
