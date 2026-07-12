package twitch

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

type recordingEvents struct {
	mu       sync.Mutex
	statuses []contracts.PlatformStatusInfo
	messages []contracts.NormalizedChatMessage
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
	joined    []string
	departed  []string
	sent      []sentMessage
}

type sentMessage struct {
	channel string
	text    string
}

func (c *fakeClient) OnConnect(handler func())                { c.onConnect = handler }
func (c *fakeClient) OnMessage(handler func(IncomingMessage)) { c.onMessage = handler }
func (c *fakeClient) Join(channel string)                     { c.joined = append(c.joined, channel) }
func (c *fakeClient) Depart(channel string)                   { c.departed = append(c.departed, channel) }
func (c *fakeClient) Say(channel, text string)                { c.sent = append(c.sent, sentMessage{channel, text}) }
func (c *fakeClient) Reply(channel, _ string, text string) {
	c.sent = append(c.sent, sentMessage{channel, text})
}
func (c *fakeClient) Connect() error                  { return nil }
func (c *fakeClient) Disconnect() error               { return nil }
func (c *fakeClient) connected()                      { c.onConnect() }
func (c *fakeClient) receive(message IncomingMessage) { c.onMessage(message) }

func TestServiceConnectsStoredChannelPersistsIncomingMessageAndSendsLocalEcho(t *testing.T) {
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
	}
	if err := store.UpsertAccount(ctx, account, storage.AccountTokens{AccessToken: "access-token"}); err != nil {
		t.Fatalf("UpsertAccount() error = %v", err)
	}
	if err := store.SaveChannel(ctx, contracts.PlatformTwitch, "streamer"); err != nil {
		t.Fatalf("SaveChannel() error = %v", err)
	}

	client := &fakeClient{}
	events := &recordingEvents{}
	service, err := NewService(Config{
		Storage: store,
		Events:  events,
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
	if got := client.sent; len(got) != 1 || got[0] != (sentMessage{channel: "streamer", text: "hello chat"}) {
		t.Fatalf("sent = %#v", got)
	}
	if got := events.lastMessage(); got.Text != "hello chat" || got.Author.ID != "1" || got.Type != "message" {
		t.Fatalf("local echo = %#v", got)
	}
}
