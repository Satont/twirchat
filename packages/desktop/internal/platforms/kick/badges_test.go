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
