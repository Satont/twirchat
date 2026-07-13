package kick

import (
	"strings"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

const embeddedKickBadgeURLPrefix = "embedded:kick:"

// embeddedBadgeURL mirrors the badge registry used by the previous Rust
// desktop client. The frontend owns the SVG documents and resolves this stable
// marker without relying on a remote Kick CDN for the core badges.
func embeddedBadgeURL(badgeType string) string {
	var key string
	switch strings.ToLower(strings.TrimSpace(badgeType)) {
	case "broadcaster":
		key = "broadcaster"
	case "mod", "moderator":
		key = "moderator"
	case "verified":
		key = "verified"
	case "vip":
		key = "vip"
	case "og":
		key = "og"
	default:
		return ""
	}
	return embeddedKickBadgeURLPrefix + key
}

// normalizeBadges preserves every Kick badges_v2 entry. When a v2 badge
// describes a v1 badge type, Kick's v2 image takes precedence over the
// embedded fallback. This matches the old Rust desktop client.
func normalizeBadges(v1 []kickBadgeV1, v2 []kickBadgeV2) []contracts.Badge {
	v2ByType := make(map[string]kickBadgeV2, len(v2))
	for _, badge := range v2 {
		v2ByType[badge.BadgeType] = badge
	}

	v1Types := make(map[string]struct{}, len(v1))
	badges := make([]contracts.Badge, 0, len(v1)+len(v2))
	for _, badge := range v1 {
		v1Types[badge.Type] = struct{}{}
		imageURL := embeddedBadgeURL(badge.Type)
		if v2Badge, ok := v2ByType[badge.Type]; ok {
			imageURL = v2Badge.ImageURL
		}
		badges = append(badges, contracts.Badge{
			ID:       badge.Type,
			Type:     badge.Type,
			Text:     badge.Text,
			ImageURL: imageURL,
		})
	}

	for _, badge := range v2 {
		if _, exists := v1Types[badge.BadgeType]; exists {
			continue
		}
		badges = append(badges, contracts.Badge{
			ID:       badge.Name,
			Type:     badge.Name,
			Text:     badge.Name,
			ImageURL: badge.ImageURL,
		})
	}
	return badges
}
