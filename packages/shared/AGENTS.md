# TwirChat Shared

Shared types, constants, and protocol definitions for TwirChat monorepo. Consumed by both `@twirchat/desktop` and `@twirchat/backend`.

## OVERVIEW

This package contains the canonical contracts between desktop and backend: message types, protocol definitions, and shared constants. Changes here affect both packages.

## STRUCTURE

```
packages/shared/
├── index.ts          # Re-exports all public APIs
├── types.ts          # NormalizedChatMessage, NormalizedEvent, Account, AppSettings
├── constants.ts      # OVERLAY_SERVER_PORT, KICK_PUSHER_WS, platform defaults
├── protocol.ts       # WebSocket message types (backend ↔ desktop)
└── logger.ts         # Structured logging utility
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new message type | `types.ts` | Follow NormalizedChatMessage/NormalizedEvent patterns |
| Add protocol message | `protocol.ts` | Update both BackendToDesktopMessage and DesktopToBackendMessage |
| Add shared constant | `constants.ts` | Use UPPER_SNAKE_CASE |
| Change logging format | `logger.ts` | JSON in prod, colored in dev |

## CONVENTIONS

**Stable Exports Policy**
- Never remove fields from exported types without major version bump
- Prefer adding optional fields over changing existing ones
- Normalized event IDs: use platform prefix (`twitch:raid:${userId}:${Date.now()}`)

**Type Naming**
- PascalCase for interfaces/types: `NormalizedChatMessage`, `AppSettings`
- Use `export type` for type-only exports to enable tree-shaking

**Imports**
```typescript
// Prefer type-only imports
import type { NormalizedChatMessage } from "./types";
```

## ANTI-PATTERNS (THIS PACKAGE)

- **DON'T** edit generated code in `protocol.ts` if it's codegen output
- **DON'T** add runtime dependencies to this package (keep it types + utilities only)
- **DON'T** break backward compatibility without updating both desktop and backend

## COMMANDS

```bash
# No build needed - imported directly via TypeScript
# Type checking (run from repo root or package)
bun run typecheck
```

## NOTES

- This package has no `dependencies` in package.json - intentional
- All types must be JSON-serializable (sent over WebSocket/RPC)
- See root AGENTS.md for Bun-first API conventions
