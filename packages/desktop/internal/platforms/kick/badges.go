package kick

import "strings"

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
