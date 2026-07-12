package bridge

import (
	"context"
	"testing"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

type recordingTwitchChat struct {
	joined string
	left   string
	sent   struct{ channel, text, replyID string }
}

func (c *recordingTwitchChat) Statuses() []contracts.PlatformStatusInfo {
	return []contracts.PlatformStatusInfo{{Platform: contracts.PlatformTwitch, ChannelLogin: "streamer", Status: "connected", Mode: "authenticated"}}
}

func (c *recordingTwitchChat) Join(_ context.Context, channel string) error {
	c.joined = channel
	return nil
}

func (c *recordingTwitchChat) Leave(_ context.Context, channel string) error {
	c.left = channel
	return nil
}

func (c *recordingTwitchChat) Send(_ context.Context, channel, text, replyID string) error {
	c.sent.channel, c.sent.text, c.sent.replyID = channel, text, replyID
	return nil
}

func TestRegisterTwitchHandlersRoutesOnlyTwitchRequests(t *testing.T) {
	registry := NewHandlerRegistry()
	chat := &recordingTwitchChat{}
	RegisterTwitchHandlers(registry, chat)
	service := NewDesktopService(registry)

	if _, err := service.Call(contracts.GatewayRequest{Method: contracts.RequestJoinChannel, Params: map[string]any{
		"platform": "twitch", "channelSlug": "Streamer",
	}}); err != nil {
		t.Fatalf("joinChannel error = %v", err)
	}
	if got, want := chat.joined, "Streamer"; got != want {
		t.Errorf("joined = %q, want %q", got, want)
	}
	if _, err := service.Call(contracts.GatewayRequest{Method: contracts.RequestSendMessage, Params: map[string]any{
		"platform": "twitch", "channelId": "streamer", "text": "hello", "replyToMessageId": "parent",
	}}); err != nil {
		t.Fatalf("sendMessage error = %v", err)
	}
	if got, want := chat.sent, (struct{ channel, text, replyID string }{"streamer", "hello", "parent"}); got != want {
		t.Errorf("sent = %#v, want %#v", got, want)
	}
	if _, err := service.Call(contracts.GatewayRequest{Method: contracts.RequestLeaveChannel, Params: map[string]any{
		"platform": "twitch", "channelSlug": "streamer",
	}}); err != nil {
		t.Fatalf("leaveChannel error = %v", err)
	}
	if got, want := chat.left, "streamer"; got != want {
		t.Errorf("left = %q, want %q", got, want)
	}
	statuses, err := service.Call(contracts.GatewayRequest{Method: contracts.RequestGetStatuses})
	if err != nil {
		t.Fatalf("getStatuses error = %v", err)
	}
	if got := statuses.([]contracts.PlatformStatusInfo); len(got) != 1 || got[0].Status != "connected" {
		t.Errorf("statuses = %#v", got)
	}

	if _, err := service.Call(contracts.GatewayRequest{Method: contracts.RequestJoinChannel, Params: map[string]any{
		"platform": "kick", "channelSlug": "streamer",
	}}); err == nil {
		t.Fatal("joinChannel(kick) error = nil, want unsupported-platform error")
	}
}
