package contracts

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func TestFrontendModelsMarshalCamelCaseAndISOTimestamps(t *testing.T) {
	timestamp := time.Date(2026, time.July, 12, 14, 30, 0, 0, time.UTC)
	payload := struct {
		Account Account               `json:"account"`
		Message NormalizedChatMessage `json:"message"`
		Event   NormalizedEvent       `json:"event"`
		Status  PlatformStatusInfo    `json:"status"`
		Layout  WatchedChannelsLayout `json:"layout"`
		Emote   SevenTVEmote          `json:"emote"`
	}{
		Account: Account{
			ID:             "account-1",
			Platform:       PlatformTwitch,
			PlatformUserID: "123",
			Username:       "octo",
			DisplayName:    "Octo",
			AvatarURL:      "https://example.com/avatar.png",
			Scopes:         []string{"chat:read"},
			CreatedAt:      100,
			UpdatedAt:      200,
		},
		Message: NormalizedChatMessage{
			ID:        "message-1",
			Platform:  PlatformTwitch,
			ChannelID: "channel-1",
			Author: ChatAuthor{
				ID:          "author-1",
				DisplayName: "Octo",
				AvatarURL:   "https://example.com/avatar.png",
				Badges: []Badge{{
					ID:       "badge-1",
					Type:     "moderator",
					Text:     "Moderator",
					ImageURL: "https://example.com/badge.png",
				}},
			},
			Text: "hello",
			Emotes: []Emote{{
				ID:       "emote-1",
				Name:     "Wave",
				ImageURL: "https://example.com/emote.png",
				Positions: []EmotePosition{{
					Start: 0,
					End:   4,
				}},
			}},
			Timestamp: timestamp,
			Type:      "message",
		},
		Event: NormalizedEvent{
			ID:       "event-1",
			Platform: PlatformKick,
			Type:     "follow",
			User: EventUser{
				ID:          "user-1",
				DisplayName: "Viewer",
			},
			Data:      map[string]any{"count": 1},
			Timestamp: timestamp,
		},
		Status: PlatformStatusInfo{
			Platform:     PlatformYouTube,
			Status:       "connected",
			Mode:         "authenticated",
			ChannelLogin: "streamer",
		},
		Layout: WatchedChannelsLayout{
			Version: 2,
			Root: LayoutNode{
				Type: "panel",
				ID:   "panel-1",
				Content: &PanelContent{
					Type:      "watched",
					ChannelID: "watched-1",
				},
				Flex: 100,
			},
		},
		Emote: SevenTVEmote{
			ID:          "7tv-1",
			Alias:       "Wave",
			Name:        "Wave",
			Animated:    true,
			ZeroWidth:   false,
			AspectRatio: 1.5,
			ImageURL:    "https://example.com/7tv.webp",
		},
	}

	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	want := map[string]any{
		"account": map[string]any{
			"id":             "account-1",
			"platform":       "twitch",
			"platformUserId": "123",
			"username":       "octo",
			"displayName":    "Octo",
			"avatarUrl":      "https://example.com/avatar.png",
			"scopes":         []any{"chat:read"},
			"createdAt":      float64(100),
			"updatedAt":      float64(200),
		},
		"message": map[string]any{
			"id":        "message-1",
			"platform":  "twitch",
			"channelId": "channel-1",
			"author": map[string]any{
				"id":          "author-1",
				"displayName": "Octo",
				"avatarUrl":   "https://example.com/avatar.png",
				"badges": []any{map[string]any{
					"id":       "badge-1",
					"type":     "moderator",
					"text":     "Moderator",
					"imageUrl": "https://example.com/badge.png",
				}},
			},
			"text": "hello",
			"emotes": []any{map[string]any{
				"id":       "emote-1",
				"name":     "Wave",
				"imageUrl": "https://example.com/emote.png",
				"positions": []any{map[string]any{
					"start": float64(0),
					"end":   float64(4),
				}},
			}},
			"timestamp": "2026-07-12T14:30:00Z",
			"type":      "message",
		},
		"event": map[string]any{
			"id":       "event-1",
			"platform": "kick",
			"type":     "follow",
			"user": map[string]any{
				"id":          "user-1",
				"displayName": "Viewer",
			},
			"data":      map[string]any{"count": float64(1)},
			"timestamp": "2026-07-12T14:30:00Z",
		},
		"status": map[string]any{
			"platform":     "youtube",
			"status":       "connected",
			"mode":         "authenticated",
			"channelLogin": "streamer",
		},
		"layout": map[string]any{
			"version": float64(2),
			"root": map[string]any{
				"type": "panel",
				"id":   "panel-1",
				"content": map[string]any{
					"type":      "watched",
					"channelId": "watched-1",
				},
				"flex": float64(100),
			},
		},
		"emote": map[string]any{
			"id":          "7tv-1",
			"alias":       "Wave",
			"name":        "Wave",
			"animated":    true,
			"zeroWidth":   false,
			"aspectRatio": 1.5,
			"imageUrl":    "https://example.com/7tv.webp",
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("frontend JSON = %#v, want %#v", got, want)
	}
}

func TestGatewayRequestPreservesHistoricalMethodAndArgumentShape(t *testing.T) {
	request := GatewayRequest{
		Method: RequestGetUserChatHistory,
		Params: GetUserChatHistoryParams{
			Platform:       PlatformTwitch,
			PlatformUserID: "viewer-1",
			Limit:          50,
			Cursor: &UserChatHistoryCursor{
				CreatedAt: 100,
				ID:        "message-1",
			},
		},
	}

	encoded, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	if got, want := string(encoded), `{"method":"getUserChatHistory","params":{"platform":"twitch","platformUserId":"viewer-1","limit":50,"cursor":{"createdAt":100,"id":"message-1"}}}`; got != want {
		t.Errorf("GatewayRequest JSON = %s, want %s", got, want)
	}
}
