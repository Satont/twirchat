package twitch

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/seventv"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

type recordingEvents struct {
	mu       sync.Mutex
	statuses []contracts.PlatformStatusInfo
	messages []contracts.NormalizedChatMessage
}

func TestServiceSubscribesAndEnrichesEachNativeTwitchChannelWithSevenTV(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir(), storage.WithMachineID("twitch-7tv-service-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.UpsertAccount(ctx, contracts.Account{
		ID: "twitch:1", Platform: contracts.PlatformTwitch, PlatformUserID: "42", Username: "viewer",
	}, storage.AccountTokens{AccessToken: "access-token"}); err != nil {
		t.Fatalf("UpsertAccount() error = %v", err)
	}
	if err := store.SaveChannel(ctx, contracts.PlatformTwitch, "streamer"); err != nil {
		t.Fatalf("SaveChannel() error = %v", err)
	}
	client := &fakeClient{}
	sevenTV := &recordingSevenTV{}
	events := &recordingEvents{}
	service, err := NewService(Config{
		Storage: store, Events: events, SevenTV: sevenTV,
		NewClient: func(Credentials) (Client, error) { return client, nil },
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	if err := service.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() { _ = service.Stop(context.Background()) })
	if got, want := sevenTV.subscriptions, []seventv.Subscription{{
		Platform: contracts.PlatformTwitch, ChannelID: "streamer", CanonicalChannelID: "streamer",
	}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("7TV subscriptions = %#v, want %#v", got, want)
	}

	client.receive(IncomingMessage{
		ID: "message-7tv", Channel: "streamer", Text: "MyEmote", Timestamp: time.Now(),
		Author: Author{ID: "2", Username: "viewer", DisplayName: "Viewer"},
	})
	if got, want := events.lastMessage().Emotes, []contracts.Emote{{
		ID: "7tv-1", Name: "MyEmote", ImageURL: "https://cdn.test/7tv.webp", Positions: []contracts.EmotePosition{{Start: 0, End: 6}},
	}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("enriched emotes = %#v, want %#v", got, want)
	}
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

func (e *recordingEvents) lastStatus() contracts.PlatformStatusInfo {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.statuses[len(e.statuses)-1]
}

func (e *recordingEvents) lastMessage() contracts.NormalizedChatMessage {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.messages[len(e.messages)-1]
}

type fakeClient struct {
	onConnect func()
	onMessage func(IncomingMessage)
	onNotice  func(Notice)
	onSay     func(string, string)
	connect   func() error
	joined    []string
	departed  []string
	sent      []sentMessage
}

type sentMessage struct {
	channel string
	text    string
}

type recordingSevenTV struct {
	subscriptions []seventv.Subscription
	inputs        []contracts.NormalizedChatMessage
}

func (r *recordingSevenTV) Subscribe(_ context.Context, subscription seventv.Subscription) {
	r.subscriptions = append(r.subscriptions, subscription)
}

func (*recordingSevenTV) Unsubscribe(context.Context, contracts.Platform, string) {}

func (r *recordingSevenTV) Enrich(message contracts.NormalizedChatMessage) contracts.NormalizedChatMessage {
	r.inputs = append(r.inputs, message)
	message.Emotes = append(message.Emotes, contracts.Emote{
		ID: "7tv-1", Name: "MyEmote", ImageURL: "https://cdn.test/7tv.webp", Positions: []contracts.EmotePosition{{Start: 0, End: 6}},
	})
	return message
}

func (c *fakeClient) OnConnect(handler func())                { c.onConnect = handler }
func (c *fakeClient) OnMessage(handler func(IncomingMessage)) { c.onMessage = handler }
func (c *fakeClient) OnNotice(handler func(Notice))           { c.onNotice = handler }
func (c *fakeClient) Join(channel string)                     { c.joined = append(c.joined, channel) }
func (c *fakeClient) Depart(channel string)                   { c.departed = append(c.departed, channel) }
func (c *fakeClient) Say(channel, text string) {
	c.sent = append(c.sent, sentMessage{channel, text})
	if c.onSay != nil {
		c.onSay(channel, text)
	}
}
func (c *fakeClient) Reply(channel, _ string, text string) {
	c.sent = append(c.sent, sentMessage{channel, text})
}
func (c *fakeClient) Connect() error {
	if c.connect != nil {
		return c.connect()
	}
	return nil
}
func (c *fakeClient) Disconnect() error               { return nil }
func (c *fakeClient) connected()                      { c.onConnect() }
func (c *fakeClient) receive(message IncomingMessage) { c.onMessage(message) }
func (c *fakeClient) notice(notice Notice)            { c.onNotice(notice) }

func TestServiceConnectsStoredChannelPersistsIncomingMessageAndSendsThroughAPI(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir(), storage.WithMachineID("twitch-service-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	account := contracts.Account{
		ID:             "twitch:1",
		Platform:       contracts.PlatformTwitch,
		PlatformUserID: "1",
		Username:       "justovich",
		DisplayName:    "Justovich",
		Scopes:         []string{"user:write:chat"},
	}
	if err := store.UpsertAccount(ctx, account, storage.AccountTokens{AccessToken: "access-token"}); err != nil {
		t.Fatalf("UpsertAccount() error = %v", err)
	}
	if err := store.SaveChannel(ctx, contracts.PlatformTwitch, "streamer"); err != nil {
		t.Fatalf("SaveChannel() error = %v", err)
	}

	releaseConnect := make(chan struct{})
	client := &fakeClient{connect: func() error {
		<-releaseConnect
		return nil
	}}
	t.Cleanup(func() { close(releaseConnect) })
	events := &recordingEvents{}
	backendServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/twitch/send-message" {
			http.NotFound(writer, request)
			return
		}
		var payload struct {
			ChannelLogin string `json:"channelLogin"`
			Message      string `json:"message"`
			SenderID     string `json:"senderId"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Errorf("decode send request: %v", err)
		}
		if payload.ChannelLogin != "streamer" || payload.Message != "hello chat" || payload.SenderID != "1" {
			t.Errorf("send payload = %#v", payload)
		}
		_, _ = writer.Write([]byte(`{"sent":true,"messageId":"message-2"}`))
	}))
	t.Cleanup(backendServer.Close)
	backendClient, err := backend.NewHTTPClient(backendServer.URL, "secret", backendServer.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	service, err := NewService(Config{
		Storage: store,
		Events:  events,
		Backend: backendClient,
		NewClient: func(credentials Credentials) (Client, error) {
			if credentials.Username != "justovich" || credentials.AccessToken != "access-token" {
				t.Fatalf("credentials = %#v", credentials)
			}
			return client, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	if err := service.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() { _ = service.Stop(context.Background()) })

	if got, want := client.joined, []string{"streamer"}; len(got) != len(want) || got[0] != want[0] {
		t.Fatalf("joined = %#v, want %#v", got, want)
	}
	if got := events.lastStatus(); got.Status != "connecting" || got.ChannelLogin != "streamer" || got.Mode != "authenticated" {
		t.Fatalf("connecting status = %#v", got)
	}
	client.connected()
	if got := events.lastStatus(); got.Status != "connected" || got.ChannelLogin != "streamer" {
		t.Fatalf("connected status = %#v", got)
	}
	if got := service.Statuses(); len(got) != 1 || got[0].Status != "connected" || got[0].ChannelLogin != "streamer" {
		t.Fatalf("Statuses() = %#v", got)
	}

	stamp := time.Date(2026, 7, 12, 20, 0, 0, 0, time.UTC)
	client.receive(IncomingMessage{
		ID: "message-1", Channel: "streamer", Text: "Kappa", Timestamp: stamp,
		Author: Author{ID: "2", Username: "viewer", DisplayName: "Viewer", Color: "#ff00ff"},
		Emotes: []Emote{{ID: "25", Name: "Kappa", Start: 0, End: 4}},
	})
	if got := events.lastMessage(); got.ID != "message-1" || got.ChannelID != "streamer" || got.Text != "Kappa" || got.Timestamp != stamp {
		t.Fatalf("incoming message = %#v", got)
	}
	recent, err := store.RecentMessages(ctx, 10)
	if err != nil || len(recent) != 1 || recent[0].ID != "message-1" {
		t.Fatalf("RecentMessages() = %#v, %v", recent, err)
	}
	if err := service.Send(ctx, "streamer", "hello chat", ""); err != nil {
		t.Fatalf("Send() error = %v", err)
	}
	if got := client.sent; len(got) != 0 {
		t.Fatalf("IRC sent = %#v, want no IRC writes", got)
	}
	if messages, err := store.RecentMessages(ctx, 10); err != nil || len(messages) != 1 || messages[0].ID != "message-1" {
		t.Fatalf("local API optimistic echo persisted = %#v, error = %v", messages, err)
	}
}

func TestServiceReportsConnectionTimeoutInsteadOfLeavingChannelConnecting(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir(), storage.WithMachineID("twitch-timeout-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	account := contracts.Account{ID: "twitch:1", Platform: contracts.PlatformTwitch, Username: "viewer"}
	if err := store.UpsertAccount(ctx, account, storage.AccountTokens{AccessToken: "access-token"}); err != nil {
		t.Fatalf("UpsertAccount() error = %v", err)
	}
	if err := store.SaveChannel(ctx, contracts.PlatformTwitch, "streamer"); err != nil {
		t.Fatalf("SaveChannel() error = %v", err)
	}
	releaseConnect := make(chan struct{})
	client := &fakeClient{connect: func() error {
		<-releaseConnect
		return nil
	}}
	t.Cleanup(func() { close(releaseConnect) })
	events := &recordingEvents{}
	service, err := NewService(Config{
		Storage: store, Events: events, NewClient: func(Credentials) (Client, error) { return client, nil },
		ConnectTimeout: 5 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	if err := service.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		events.mu.Lock()
		last := events.statuses[len(events.statuses)-1]
		events.mu.Unlock()
		if last.Status == "error" {
			if last.Error == "" {
				t.Fatal("timeout status error is empty")
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("last status = %#v, want connection timeout error", events.lastStatus())
}

func TestServiceReportsTwitchServerNoticeForTheTargetChannel(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir(), storage.WithMachineID("twitch-notice-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	events := &recordingEvents{}
	service, err := NewService(Config{Storage: store, Events: events})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	service.onNotice(Notice{Channel: "stray228", MsgID: "msg_rejected", Message: "Your message was not sent."})
	status := events.lastStatus()
	if status.ChannelLogin != "stray228" || status.Status != "error" || status.Error != "Your message was not sent." {
		t.Fatalf("delivery rejection status = %#v", status)
	}
}

func TestServiceRequiresHelixChatWriteScopeBeforeSending(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir(), storage.WithMachineID("twitch-scope-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.UpsertAccount(ctx, contracts.Account{
		ID: "twitch:1", Platform: contracts.PlatformTwitch, PlatformUserID: "1", Username: "viewer",
		Scopes: []string{"chat:read", "chat:edit"},
	}, storage.AccountTokens{AccessToken: "access-token"}); err != nil {
		t.Fatalf("UpsertAccount() error = %v", err)
	}
	service, err := NewService(Config{Storage: store, Events: &recordingEvents{}})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	err = service.Send(ctx, "streamer", "hello", "")
	if err == nil || !strings.Contains(err.Error(), "Reconnect Twitch") {
		t.Fatalf("Send() error = %v, want reconnect guidance", err)
	}
}
