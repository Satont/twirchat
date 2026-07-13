package kick

import "testing"

func TestEmbeddedBadgeURLMatchesKickBadgeRegistry(t *testing.T) {
	tests := map[string]string{
		"broadcaster": "embedded:kick:broadcaster",
		"mod":         "embedded:kick:moderator",
		"moderator":   "embedded:kick:moderator",
		"verified":    "embedded:kick:verified",
		"vip":         "embedded:kick:vip",
		"og":          "embedded:kick:og",
	}

	for badgeType, want := range tests {
		if got := embeddedBadgeURL(badgeType); got != want {
			t.Errorf("embeddedBadgeURL(%q) = %q, want %q", badgeType, got, want)
		}
	}
}

func TestEmbeddedBadgeURLOmitsBadgesWithoutBundledArt(t *testing.T) {
	for _, badgeType := range []string{"subscriber", "founder", "unknown"} {
		if got := embeddedBadgeURL(badgeType); got != "" {
			t.Errorf("embeddedBadgeURL(%q) = %q, want empty", badgeType, got)
		}
	}
}

func TestNormalizeBadgesIncludesEveryDistinctV2Badge(t *testing.T) {
	badges := normalizeBadges(
		[]kickBadgeV1{{Type: "broadcaster", Text: "Broadcaster"}},
		[]kickBadgeV2{
			{Name: "broadcaster", BadgeType: "broadcaster", ImageURL: "https://cdn.test/broadcaster-v2.png"},
			{Name: "level", BadgeType: "global", ImageURL: "https://cdn.test/level-18.png"},
			{Name: "custom-event", BadgeType: "event", ImageURL: "https://cdn.test/event.png"},
		},
	)

	if len(badges) != 3 {
		t.Fatalf("badge count = %d, want 3", len(badges))
	}
	if got := badges[0].ImageURL; got != "https://cdn.test/broadcaster-v2.png" {
		t.Errorf("v1 broadcaster image = %q, want v2 image", got)
	}
	if got := badges[1]; got.ID != "level" || got.Type != "level" || got.Text != "level" || got.ImageURL != "https://cdn.test/level-18.png" {
		t.Errorf("level badge = %#v", got)
	}
	if got := badges[2]; got.ID != "custom-event" || got.ImageURL != "https://cdn.test/event.png" {
		t.Errorf("custom v2 badge = %#v", got)
	}
}
