# Decisions — autocomplete plan

## [2026-04-09] Architecture Decisions

- RPC approach chosen over HTTP endpoint for emote access (plan constraint: no backend changes)
- mentionColorCache export (not duplicate) approach confirmed
- AutocompletePopup positioned above textarea via `position: absolute; bottom: 100%` on parent `.chat-input-bar` (relative)
- `mousedown.prevent` pattern for popup items to prevent textarea blur
