# Decisions — user-aliases

## Architectural Decisions
- UserAlias interface defined in rpc.ts (not user-alias-store.ts) — to avoid importing bun:sqlite into webview bundle
- Composite PRIMARY KEY (platform, platform_user_id) — no separate id column
- In-memory store update after setAlias/removeAlias — no re-fetch needed
- aliasMap as computed() from aliases ref — O(1) lookup per message render
- Dialog for input (not inline in ContextMenuItem) — focus closes menu
