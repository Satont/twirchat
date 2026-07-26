package kick

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/seventv"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
	"github.com/coder/websocket"
)

type recordingEvents struct {
	mu       sync.Mutex
	statuses []contracts.PlatformStatusInfo
	messages []contracts.NormalizedChatMessage
	outcomes []contracts.ModerationOutcome
}

func (e *recordingEvents) Status(status contracts.PlatformStatusInfo) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.statuses = append(e.statuses, status)
}

func (e *recordingEvents) Message(message contracts.NormalizedChatMessage) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.messages = append(e.messages, message)
}

func (e *recordingEvents) Moderation(outcome contracts.ModerationOutcome) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.outcomes = append(e.outcomes, outcome)
}

func (e *recordingEvents) statusSequence() []contracts.PlatformStatusInfo {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]contracts.PlatformStatusInfo(nil), e.statuses...)
}

func (e *recordingEvents) chatMessages() []contracts.NormalizedChatMessage {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]contracts.NormalizedChatMessage(nil), e.messages...)
}

// quietPusherServer accepts the chat WebSocket and holds it open without
// sending frames, so tests starting the service stay hermetic.
func quietPusherServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(writer, request, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		<-request.Context().Done()
	}))
	t.Cleanup(server.Close)
	return server
}

func pusherWSURL(server *httptest.Server) string {
	return "ws" + strings.TrimPrefix(server.URL, "http")
}

func TestParsePusherModerationOutcomeUsesOnlyValidCurrentFrames(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)

	deleted, ok := parsePusherModerationOutcome(
		"kick-channel",
		`App\Events\MessageDeletedEvent`,
		json.RawMessage(`{"message":{"id":"message-1"}}`),
		now,
	)
	if !ok {
		t.Fatal("delete outcome was not recognized")
	}
	if want := (contracts.ModerationOutcome{
		Platform: contracts.PlatformKick, ChannelID: "kick-channel", Action: "delete_message", MessageID: "message-1",
	}); deleted != want {
		t.Fatalf("delete outcome = %#v, want %#v", deleted, want)
	}

	timeout, ok := parsePusherModerationOutcome(
		"kick-channel",
		`App\Events\UserBannedEvent`,
		json.RawMessage(`{"user":{"id":42},"expires_at":"2026-07-13T12:10:00Z"}`),
		now,
	)
	if !ok {
		t.Fatal("timeout outcome was not recognized")
	}
	if want := (contracts.ModerationOutcome{
		Platform: contracts.PlatformKick, ChannelID: "kick-channel", Action: "timeout", TargetUserID: "42", DurationSeconds: 600,
	}); timeout != want {
		t.Fatalf("timeout outcome = %#v, want %#v", timeout, want)
	}

	ban, ok := parsePusherModerationOutcome(
		"kick-channel",
		`App\Events\UserBannedEvent`,
		json.RawMessage(`{"user":{"id":42}}`),
		now,
	)
	if !ok {
		t.Fatal("ban outcome was not recognized")
	}
	if want := (contracts.ModerationOutcome{
		Platform: contracts.PlatformKick, ChannelID: "kick-channel", Action: "ban", TargetUserID: "42",
	}); ban != want {
		t.Fatalf("ban outcome = %#v, want %#v", ban, want)
	}

	if _, ok := parsePusherModerationOutcome(
		"kick-channel",
		`App\Events\UserBannedEvent`,
		json.RawMessage(`{"user":{"id":42},"expires_at":"not-a-date"}`),
		now,
	); ok {
		t.Fatal("malformed Pusher moderation payload produced an outcome")
	}
}

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
	service, err := NewService(Config{
		Storage: store, Events: events, Backend: backendClient, ChatAPIURL: server.URL + "/chat",
		PusherURL: pusherWSURL(quietPusherServer(t)),
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	t.Cleanup(func() { _ = service.Stop(context.Background()) })
	if err := service.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	statuses := events.statusSequence()
	if got := statuses[len(statuses)-1]; got.Platform != contracts.PlatformKick || got.Status != "connected" || got.ChannelLogin != "satont" {
		t.Fatalf("status = %#v", got)
	}
	if err := service.Send(ctx, "satont", "hello", ""); err != nil {
		t.Fatalf("Send() error = %v", err)
	}
}

func TestServiceReturnsKickProviderRejectionText(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir(), storage.WithMachineID("kick-rejection-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.UpsertAccount(ctx, contracts.Account{ID: "kick:1", Platform: contracts.PlatformKick, PlatformUserID: "1", Username: "satont", DisplayName: "Satont"}, storage.AccountTokens{AccessToken: "kick-token"}); err != nil {
		t.Fatalf("UpsertAccount() error = %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/kick/chatroom":
			_, _ = writer.Write([]byte(`{"chatroomId":44,"broadcasterUserId":1}`))
		case "/chat":
			writer.WriteHeader(http.StatusForbidden)
			_, _ = writer.Write([]byte(`{"message":"Followers-only mode for 10 minutes"}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	t.Cleanup(server.Close)
	backendClient, err := backend.NewHTTPClient(server.URL, "secret", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	service, err := NewService(Config{
		Storage: store, Events: &recordingEvents{}, Backend: backendClient, ChatAPIURL: server.URL + "/chat",
		PusherURL: pusherWSURL(quietPusherServer(t)),
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	t.Cleanup(func() { _ = service.Stop(context.Background()) })
	err = service.Send(ctx, "satont", "hello", "")
	if err == nil || !errors.Is(err, ErrDeliveryRejected) || !strings.Contains(err.Error(), "Followers-only mode") {
		t.Fatalf("Send() error = %v, want provider rejection", err)
	}
}

func TestParseKickEmotesReplacesMarkersAndUsesJavaScriptStringPositions(t *testing.T) {
	text, emotes := parseKickEmotes("🙂 [emote:37232:чё] [emote:17:Clap]")
	if got, want := text, "🙂 чё Clap"; got != want {
		t.Fatalf("text = %q, want %q", got, want)
	}
	if got, want := emotes, []contracts.Emote{
		{
			ID:       "37232",
			Name:     "чё",
			ImageURL: "https://files.kick.com/emotes/37232/fullsize",
			Positions: []contracts.EmotePosition{
				{Start: 3, End: 4},
			},
		},
		{
			ID:       "17",
			Name:     "Clap",
			ImageURL: "https://files.kick.com/emotes/17/fullsize",
			Positions: []contracts.EmotePosition{
				{Start: 6, End: 9},
			},
		},
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("emotes = %#v, want %#v", got, want)
	}
}

func TestParseKickEmotesLeavesMalformedMarkersAsText(t *testing.T) {
	text, emotes := parseKickEmotes("[emote::bad] [emote:7:] [emote:7:unfinished")
	if got, want := text, "[emote::bad] [emote:7:] [emote:7:unfinished"; got != want {
		t.Fatalf("text = %q, want %q", got, want)
	}
	if len(emotes) != 0 {
		t.Fatalf("emotes = %#v, want none", emotes)
	}
}

func TestServiceParsesAndEnrichesIncomingKickMessageWithSevenTV(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir(), storage.WithMachineID("kick-7tv-service-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	server := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(server.Close)
	backendClient, err := backend.NewHTTPClient(server.URL, "secret", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	events := &recordingEvents{}
	service, err := NewService(Config{Storage: store, Events: events, Backend: backendClient, SevenTV: &recordingSevenTV{}})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	raw := json.RawMessage(`{
		"id":"kick-message-7tv","chatroom_id":1,"content":"[emote:7:Peepo] MyEmote","created_at":"2026-07-13T10:00:00Z",
		"sender":{"id":2,"username":"Viewer","slug":"viewer","profile_picture":"","identity":{"color":"","badges":[],"badges_v2":[]}}
	}`)
	service.handlePusherMessage(ctx, "kick-channel", raw)
	if got, want := len(events.chatMessages()), 1; got != want {
		t.Fatalf("messages = %#v, want one", events.chatMessages())
	}
	message := events.chatMessages()[0]
	if got, want := message.Text, "Peepo MyEmote"; got != want {
		t.Fatalf("text = %q, want %q", got, want)
	}
	if got, want := message.Emotes, []contracts.Emote{
		{ID: "7", Name: "Peepo", ImageURL: "https://files.kick.com/emotes/7/fullsize", Positions: []contracts.EmotePosition{{Start: 0, End: 4}}},
		{ID: "7tv-1", Name: "MyEmote", ImageURL: "https://cdn.test/7tv.webp", Positions: []contracts.EmotePosition{{Start: 6, End: 12}}},
	}; !reflect.DeepEqual(got, want) {
		t.Fatalf("emotes = %#v, want %#v", got, want)
	}
}

type recordingSevenTV struct{}

func TestServiceReconnectsAfterPusherDrops(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	store, err := storage.Open(ctx, t.TempDir(), storage.WithMachineID("kick-reconnect-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.SaveChannel(ctx, contracts.PlatformKick, "satont"); err != nil {
		t.Fatalf("SaveChannel() error = %v", err)
	}

	var dials atomic.Int32
	pusher := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(writer, request, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		attempt := dials.Add(1)
		if err := connection.Write(request.Context(), websocket.MessageText, []byte(`{"event":"pusher:connection_established","data":"{}"}`)); err != nil {
			return
		}
		if _, _, err := connection.Read(request.Context()); err != nil {
			return
		}
		if err := connection.Write(request.Context(), websocket.MessageText, []byte(`{"event":"pusher_internal:subscription_succeeded","data":"{}"}`)); err != nil {
			return
		}
		if attempt == 1 {
			_ = connection.Close(4200, "Please reconnect immediately")
			return
		}
		<-request.Context().Done()
	}))
	t.Cleanup(pusher.Close)

	backendServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/api/kick/chatroom" {
			_, _ = writer.Write([]byte(`{"chatroomId":44,"broadcasterUserId":1}`))
			return
		}
		http.NotFound(writer, request)
	}))
	t.Cleanup(backendServer.Close)
	backendClient, err := backend.NewHTTPClient(backendServer.URL, "secret", backendServer.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}

	events := &recordingEvents{}
	service, err := NewService(Config{
		Storage: store, Events: events, Backend: backendClient,
		PusherURL: pusherWSURL(pusher), ReconnectInitial: time.Millisecond, ReconnectMaximum: 5 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	t.Cleanup(func() { _ = service.Stop(context.Background()) })
	if err := service.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	deadline := time.Now().Add(5 * time.Second)
	for {
		sequence := events.statusSequence()
		sawError := false
		reconnected := false
		for _, status := range sequence {
			if status.Status == "error" {
				sawError = true
			}
			if sawError && status.Status == "connected" {
				reconnected = true
			}
		}
		if reconnected && dials.Load() >= 2 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("statuses after drop = %#v, dials = %d; want error followed by connected", sequence, dials.Load())
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestServiceLeaveStopsPusherReconnect(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	store, err := storage.Open(ctx, t.TempDir(), storage.WithMachineID("kick-leave-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.SaveChannel(ctx, contracts.PlatformKick, "satont"); err != nil {
		t.Fatalf("SaveChannel() error = %v", err)
	}

	var dials atomic.Int32
	pusher := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(writer, request, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		dials.Add(1)
		<-request.Context().Done()
	}))
	t.Cleanup(pusher.Close)

	backendServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/api/kick/chatroom" {
			_, _ = writer.Write([]byte(`{"chatroomId":44,"broadcasterUserId":1}`))
			return
		}
		http.NotFound(writer, request)
	}))
	t.Cleanup(backendServer.Close)
	backendClient, err := backend.NewHTTPClient(backendServer.URL, "secret", backendServer.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}

	events := &recordingEvents{}
	service, err := NewService(Config{
		Storage: store, Events: events, Backend: backendClient,
		PusherURL: pusherWSURL(pusher), ReconnectInitial: time.Millisecond, ReconnectMaximum: 5 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	t.Cleanup(func() { _ = service.Stop(context.Background()) })
	if err := service.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for dials.Load() < 1 {
		if time.Now().After(deadline) {
			t.Fatal("pusher was not dialed")
		}
		time.Sleep(5 * time.Millisecond)
	}

	if err := service.Leave(ctx, "satont"); err != nil {
		t.Fatalf("Leave() error = %v", err)
	}

	statuses := events.statusSequence()
	if got := statuses[len(statuses)-1]; got.Status != "disconnected" {
		t.Fatalf("last status = %#v, want disconnected", got)
	}

	time.Sleep(50 * time.Millisecond)
	if got := dials.Load(); got != 1 {
		t.Fatalf("dials after Leave = %d, want 1", got)
	}
	for _, status := range events.statusSequence()[len(statuses):] {
		if status.Status == "error" {
			t.Fatalf("Leave produced an error status: %#v", status)
		}
	}
}
func (*recordingSevenTV) Subscribe(context.Context, seventv.Subscription)         {}
func (*recordingSevenTV) Unsubscribe(context.Context, contracts.Platform, string) {}
func (*recordingSevenTV) Enrich(message contracts.NormalizedChatMessage) contracts.NormalizedChatMessage {
	message.Emotes = append(message.Emotes, contracts.Emote{
		ID: "7tv-1", Name: "MyEmote", ImageURL: "https://cdn.test/7tv.webp", Positions: []contracts.EmotePosition{{Start: 6, End: 12}},
	})
	return message
}

type stubTokenRefresher struct {
	store *storage.Storage
	calls int
}

func (r *stubTokenRefresher) Refresh(ctx context.Context, accountID string) error {
	r.calls++
	return r.store.UpdateAccountTokens(ctx, accountID, storage.AccountTokens{AccessToken: "fresh-token"})
}

func TestServiceRefreshesKickTokenAfterUnauthorized(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir(), storage.WithMachineID("kick-refresh-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	refreshToken := "refresh-token"
	if err := store.UpsertAccount(ctx, contracts.Account{ID: "kick:1", Platform: contracts.PlatformKick, PlatformUserID: "1", Username: "satont", DisplayName: "Satont"}, storage.AccountTokens{AccessToken: "stale-token", RefreshToken: &refreshToken}); err != nil {
		t.Fatalf("UpsertAccount() error = %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/kick/chatroom":
			_, _ = writer.Write([]byte(`{"chatroomId":44,"broadcasterUserId":1}`))
		case "/chat":
			if request.Header.Get("Authorization") != "Bearer fresh-token" {
				writer.WriteHeader(http.StatusUnauthorized)
				_, _ = writer.Write([]byte(`{"message":"Unauthorized"}`))
				return
			}
			_, _ = writer.Write([]byte(`{}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	t.Cleanup(server.Close)
	backendClient, err := backend.NewHTTPClient(server.URL, "secret", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	refresher := &stubTokenRefresher{store: store}
	service, err := NewService(Config{
		Storage: store, Events: &recordingEvents{}, Backend: backendClient, ChatAPIURL: server.URL + "/chat",
		PusherURL: pusherWSURL(quietPusherServer(t)), Refresher: refresher,
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	t.Cleanup(func() { _ = service.Stop(context.Background()) })
	if err := service.Send(ctx, "satont", "hello", ""); err != nil {
		t.Fatalf("Send() error = %v", err)
	}
	if refresher.calls != 1 {
		t.Fatalf("refresher calls = %d, want 1", refresher.calls)
	}
}

func TestServiceRefreshesExpiredKickTokenBeforeSending(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir(), storage.WithMachineID("kick-expired-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	refreshToken := "refresh-token"
	expiresAt := time.Now().Add(-time.Hour).Unix()
	if err := store.UpsertAccount(ctx, contracts.Account{ID: "kick:1", Platform: contracts.PlatformKick, PlatformUserID: "1", Username: "satont", DisplayName: "Satont"}, storage.AccountTokens{AccessToken: "stale-token", RefreshToken: &refreshToken, ExpiresAt: &expiresAt}); err != nil {
		t.Fatalf("UpsertAccount() error = %v", err)
	}
	chatRequests := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/kick/chatroom":
			_, _ = writer.Write([]byte(`{"chatroomId":44,"broadcasterUserId":1}`))
		case "/chat":
			chatRequests++
			if request.Header.Get("Authorization") != "Bearer fresh-token" {
				writer.WriteHeader(http.StatusUnauthorized)
				_, _ = writer.Write([]byte(`{"message":"Unauthorized"}`))
				return
			}
			_, _ = writer.Write([]byte(`{}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	t.Cleanup(server.Close)
	backendClient, err := backend.NewHTTPClient(server.URL, "secret", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	refresher := &stubTokenRefresher{store: store}
	service, err := NewService(Config{
		Storage: store, Events: &recordingEvents{}, Backend: backendClient, ChatAPIURL: server.URL + "/chat",
		PusherURL: pusherWSURL(quietPusherServer(t)), Refresher: refresher,
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	t.Cleanup(func() { _ = service.Stop(context.Background()) })
	if err := service.Send(ctx, "satont", "hello", ""); err != nil {
		t.Fatalf("Send() error = %v", err)
	}
	if refresher.calls != 1 {
		t.Fatalf("refresher calls = %d, want 1 proactive refresh", refresher.calls)
	}
	if chatRequests != 1 {
		t.Fatalf("chat requests = %d, want 1 (no 401 retry after proactive refresh)", chatRequests)
	}
}
