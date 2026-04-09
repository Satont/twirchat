# Emote Picker — Issues & Gotchas

## Known Pitfalls (from plan research)
1. SevenTVEmote has `.alias` not `.label` — map to `{ ...emote, label: emote.alias }` before fuzzyFilter
2. replaceToken silently drops insertion when no `:token` active — MUST use two-branch logic
3. VGrid needs FIXED height container (not max-height) for scroll container detection
4. emote.id as VGrid key — never array index
5. Scroll must reset to index 0 on filter change (out-of-bounds rendering prevention)
6. Popover direction: opens downward by default — use `side="top"` + `avoidCollisions`
7. EmoteTooltip inside popover causes z-index/portal stacking conflicts — use `title` attribute only
8. Non-scoped CSS required for PopoverContent (reka-ui portals outside component DOM)
9. Nested Transition/TransitionGroup on virtual scroll items causes flicker with recycled DOM
