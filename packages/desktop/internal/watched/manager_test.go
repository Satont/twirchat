package watched

import (
	"context"
	"sync"
	"testing"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

type fakeChat struct {
	mu       sync.Mutex
	joined   []string
	left     []string
	sent     []string
	statuses []contracts.PlatformStatusInfo
}

func (c *fakeChat) Join(_ context.Context, channel string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.joined = append(c.joined, channel)
	return nil
}

func (c *fakeChat) Leave(_ context.Context, channel string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.left = append(c.left, channel)
	return nil
}

func (c *fakeChat) Send(_ context.Context, channel, text, _ string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sent = append(c.sent, channel+":"+text)
	return nil
}

func (c *fakeChat) Statuses() []contracts.PlatformStatusInfo {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]contracts.PlatformStatusInfo(nil), c.statuses...)
}

type recordingEvents struct {
	mu       sync.Mutex
	messages []contracts.WatchedChannelMessage
	statuses []contracts.WatchedChannelStatus
}

func (e *recordingEvents) EmitChatMessage(contracts.NormalizedChatMessage) bool { return true }
func (e *recordingEvents) EmitChatModeration(contracts.ModerationOutcome) bool  { return true }
func (e *recordingEvents) EmitPlatformStatus(contracts.PlatformStatusInfo) bool { return true }
func (e *recordingEvents) EmitWatchedChannelMessage(message contracts.WatchedChannelMessage) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.messages = append(e.messages, message)
	return true
}
func (e *recordingEvents) EmitWatchedChannelStatus(status contracts.WatchedChannelStatus) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.statuses = append(e.statuses, status)
	return true
}

func TestManagerRestoresWatchedChannelAndRoutesPlatformEvents(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir(), storage.WithMachineID("watched-manager-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	channel, err := store.UpsertWatchedChannel(ctx, contracts.PlatformTwitch, "stray228", "stray228")
	if err != nil {
		t.Fatalf("UpsertWatchedChannel() error = %v", err)
	}
	chat := &fakeChat{}
	events := &recordingEvents{}
	manager, err := NewManager(Config{Storage: store, Events: events, Chats: map[contracts.Platform]Chat{contracts.PlatformTwitch: chat}})
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}

	if err := manager.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if got, want := chat.joined, []string{"stray228"}; len(got) != 1 || got[0] != want[0] {
		t.Fatalf("joined = %#v, want %#v", got, want)
	}

	manager.Status(contracts.PlatformStatusInfo{Platform: contracts.PlatformTwitch, ChannelLogin: "stray228", Status: "connected"})
	manager.Message(contracts.NormalizedChatMessage{Platform: contracts.PlatformTwitch, ChannelID: "stray228", ID: "message-1"})
	statuses := manager.Statuses()
	if len(statuses) != 1 || statuses[0].ChannelID != channel.ID || statuses[0].Status.Status != "connected" {
		t.Fatalf("Statuses() = %#v", statuses)
	}
	if len(events.messages) != 1 || events.messages[0].ChannelID != channel.ID || events.messages[0].Message.ID != "message-1" {
		t.Fatalf("watched messages = %#v", events.messages)
	}
}

func TestManagerAddsAndRemovesWatchedChannelThroughChat(t *testing.T) {
	ctx := context.Background()
	store, err := storage.Open(ctx, t.TempDir(), storage.WithMachineID("watched-manager-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	chat := &fakeChat{}
	manager, err := NewManager(Config{Storage: store, Events: &recordingEvents{}, Chats: map[contracts.Platform]Chat{contracts.PlatformKick: chat}})
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}

	channel, err := manager.Add(ctx, contracts.PlatformKick, "Satont")
	if err != nil {
		t.Fatalf("Add() error = %v", err)
	}
	if got, want := chat.joined, []string{"satont"}; len(got) != 1 || got[0] != want[0] {
		t.Fatalf("joined = %#v, want %#v", got, want)
	}
	if err := manager.Remove(ctx, channel.ID); err != nil {
		t.Fatalf("Remove() error = %v", err)
	}
	if got, want := chat.left, []string{"satont"}; len(got) != 1 || got[0] != want[0] {
		t.Fatalf("left = %#v, want %#v", got, want)
	}
}
