# 7TV Integration Redesign Plan

## Executive Summary

Move 7TV integration from hardcoded user ID in desktop to a scalable backend-managed system supporting multiple channels with dynamic subscription management, connection pooling, and image proxying.

---

## Current State

**Location:** `packages/desktop/src/platforms/7tv/`

- Hardcoded `seventvUserId` in settings
- Single-channel support only
- Desktop-only implementation
- Direct CDN image URLs (blocked in Russia)

---

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Desktop App   │────▶│  Backend Service │────▶│   7TV GraphQL   │
│   (Client)      │◀────│   (Orchestrator) │◀────│     & WS API    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │
        │   WebSocket            │   7TV EventAPI
        │   (commands/events)    │   (pooled connections)
        ▼                        ▼
   Channel Join/Leave      ┌─────────────────────┐
   Emote Updates           │  Connection Pool    │
   Image Proxy Requests    │  (max 500 weight)   │
                           └─────────────────────┘
```

---

## Phase 1: GraphQL Layer with Code Generation

### 1.1 Setup graphql-codegen

**New files:**

- `packages/backend/src/seventv/codegen.ts` - Codegen configuration
- `packages/backend/src/seventv/schema.graphql` - 7TV schema (fetched via introspection)
- `packages/backend/src/seventv/gql/` - Generated types and client

**Dependencies to add:**

```json
{
  "@graphql-codegen/cli": "^5.0.0",
  "@graphql-codegen/typescript": "^4.0.0",
  "@graphql-codegen/typescript-operations": "^4.0.0",
  "@graphql-codegen/typescript-urql": "^4.0.0",
  "@urql/core": "^5.0.0",
  "graphql": "^16.8.0"
}
```

### 1.2 Schema Introspection

Use graphql-codegen with url to fetch schema from 7TV GraphQL endpoint, add graphql config file to make editor know about schema. Write queries not in .gql files, instead use typescript and then generation approach. Add support dev mode in our dev script so when we run app and change gql queries everything getting updated.

### 1.3 Key Queries to Generate

**Query 1: Find User by Platform Connection**

Not exact query:

```graphql
query GetUserByConnection($platform: Platform!, $platformId: String!) {
  users {
    userByConnection(platform: $platform, platformId: $platformId) {
      id
      displayName
      emoteSets {
        id
        name
        emotes(perPage: 1000) {
          items {
            id
            alias
            flags {
              zeroWidth
            }
            emote {
              id
              defaultName
              flags {
                animated
              }
              aspectRatio
              images {
                url
                mime
                size
                scale
                width
                height
                frameCount
              }
            }
          }
        }
      }
    }
  }
}
```

**Query 2: Get Emote Set by ID**

Not exact query:

```graphql
query GetEmoteSet($id: Id!) {
  emoteSets {
    emoteSet(id: $id) {
      id
      name
      emotes(perPage: 1000) {
        items {
          id
          alias
          flags {
            zeroWidth
          }
          emote {
            id
            defaultName
            flags {
              animated
            }
            aspectRatio
            images {
              url
              mime
              size
              scale
              width
              height
              frameCount
            }
          }
        }
      }
    }
  }
}
```

### 1.4 Codegen Configuration

```typescript
// codegen.ts
import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "./src/seventv/schema.graphql",
  documents: "./src/seventv/queries/*.graphql",
  generates: {
    "./src/seventv/gql/": {
      preset: "client",
      plugins: [],
      config: {
        useTypeImports: true,
        skipTypename: true,
      },
    },
  },
};

export default config;
```

**Script to add:**

```json
"generate:7tv": "graphql-codegen --config codegen.ts"
```

---

## Phase 2: Backend 7TV Service

### 2.1 Service Structure

```
packages/backend/src/seventv/
├── client.ts           # Urql client setup
├── codegen.ts          # Codegen config
├── gql/                # Generated types
│   ├── graphql.ts
│   └── gql.ts
├── queries/
│   ├── getUserByConnection.graphql
│   └── getEmoteSet.graphql
├── schema.graphql      # 7TV introspected schema
├── cache.ts            # Emote cache with TTL
├── subscription-manager.ts  # EventAPI subscription pooling
├── event-client.ts     # WebSocket connection to 7TV
├── image-proxy.ts      # Image proxy route handler
└── index.ts            # Public API exports
```

### 2.2 Emote Cache with TTL

```typescript
// cache.ts
interface CachedEmoteSet {
  id: string;
  channelId: string;
  platform: Platform;
  emotes: SevenTVEmoteSetEmote[];
  fetchedAt: Date;
  ttl: number; // ms
}

class SevenTVCache {
  private cache = new Map<string, CachedEmoteSet>();
  private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

  // Key format: `${platform}:${channelId}`

  get(channelKey: string): CachedEmoteSet | undefined;
  set(channelKey: string, data: CachedEmoteSet): void;
  has(channelKey: string): boolean;
  invalidate(channelKey: string): void;
  invalidateAll(): void;

  // Update specific emote in cached set
  updateEmote(
    channelKey: string,
    emoteId: string,
    update: Partial<Emote>,
  ): void;
  addEmote(channelKey: string, emote: SevenTVEmoteSetEmote): void;
  removeEmote(channelKey: string, emoteId: string): void;

  // Cleanup expired entries
  cleanup(): void;
}
```

### 2.3 Subscription Manager with Connection Pooling

**Key Requirements from 7TV EventAPI:**

- Subscription limit per WebSocket: specified in Hello payload (typically ~500 weight)
- Each subscription has a "weight" (emote_set.update = 1, user.update = 1, etc.)
- Must handle reconnection with session resume
- Subscribe: `{"op": 35, "d": {"type": "emote_set.update", "condition": {"object_id": "..."}}}`
- Unsubscribe: `{"op": 36, "d": {"type": "emote_set.update", "condition": {"object_id": "..."}}}`

```typescript
// subscription-manager.ts

interface Subscription {
  type: "emote_set.update" | "user.update";
  condition: Record<string, string>;
  weight: number;
  channelKey: string; // `${platform}:${channelId}`
  clientSecrets: Set<string>; // Desktop clients interested
}

interface ConnectionPool {
  ws: WebSocket;
  sessionId: string;
  subscriptions: Map<string, Subscription>; // subscriptionId -> Subscription
  totalWeight: number;
  maxWeight: number;
  isReady: boolean;
}

class SevenTVSubscriptionManager {
  private pools: ConnectionPool[] = [];
  private readonly MAX_WEIGHT_PER_POOL = 500;
  private readonly POOL_TARGET_WEIGHT = 400; // Leave headroom

  // Channel -> Subscription mapping
  private channelSubscriptions = new Map<string, Subscription>();

  // Add desktop client interest in a channel
  async subscribeClient(
    clientSecret: string,
    platform: Platform,
    channelId: string,
  ): Promise<void>;

  // Remove desktop client interest
  async unsubscribeClient(
    clientSecret: string,
    platform: Platform,
    channelId: string,
  ): Promise<void>;

  // Internal: find or create pool with available capacity
  private getOrCreatePool(): ConnectionPool;

  // Internal: subscribe to 7TV EventAPI
  private async addSubscriptionToPool(
    pool: ConnectionPool,
    subscription: Subscription,
  ): Promise<void>;

  // Internal: unsubscribe from 7TV EventAPI
  private async removeSubscriptionFromPool(
    pool: ConnectionPool,
    subscriptionId: string,
  ): Promise<void>;

  // Handle incoming 7TV events
  private handleEvent(event: SevenTVEvent): void;

  // Forward event to interested desktop clients
  private forwardToClients(channelKey: string, event: SevenTVUpdateEvent): void;

  // Reconnection with resume
  private async reconnectPool(pool: ConnectionPool): Promise<void>;

  // Graceful cleanup on shutdown
  dispose(): Promise<void>;
}
```

### 2.4 Event Client (WebSocket to 7TV)

```typescript
// event-client.ts

interface SevenTVEventMessage {
  op: number;
  t?: number;
  d?: unknown;
}

interface SevenTVHello {
  heartbeat_interval: number;
  session_id: string;
  subscription_limit: number;
}

interface SevenTVDispatch {
  type: string;
  body: {
    id: string;
    actor?: { id: string; display_name: string };
    pushed?: ChangeField[];
    pulled?: ChangeField[];
    updated?: ChangeField[];
  };
}

class SevenTVEventClient {
  private ws: WebSocket | null = null;
  private heartbeatInterval: Timer | null = null;
  private reconnectTimer: Timer | null = null;
  private sessionId: string | null = null;
  private subscriptionLimit = 0;
  private pendingSubscriptions: Subscription[] = [];
  private isConnecting = false;
  private messageQueue: SevenTVEventMessage[] = [];

  // Callbacks
  onHello?: (hello: SevenTVHello) => void;
  onDispatch?: (dispatch: SevenTVDispatch) => void;
  onError?: (error: Error) => void;
  onClose?: (code: number, reason: string) => void;

  async connect(): Promise<void>;
  disconnect(): void;

  subscribe(type: string, condition: Record<string, string>): void;
  unsubscribe(type: string, condition?: Record<string, string>): void;

  private send(message: SevenTVEventMessage): void;
  private startHeartbeat(interval: number): void;
  private scheduleReconnect(delay?: number): void;
  private handleMessage(data: string): void;
}
```

### 2.5 Image Proxy

```typescript
// image-proxy.ts
import { route } from "../routes/utils";

const SEVENTV_CDN_BASE = "https://cdn.7tv.app/emote";

export function handleSevenTVImageProxy(req: Request): Response {
  const url = new URL(req.url);
  const emoteId = url.pathname.split("/").pop();
  const size = url.searchParams.get("size") || "4x";
  const format = url.searchParams.get("format") || "webp";

  if (!emoteId) {
    return new Response("Missing emote ID", { status: 400 });
  }

  const sevenTvUrl = `${SEVENTV_CDN_BASE}/${emoteId}/${size}.${format}`;

  // Proxy the request
  return fetch(sevenTvUrl, {
    headers: {
      Accept: req.headers.get("Accept") || "image/webp,image/avif,*/*",
    },
  }).then((response) => {
    // Clone and add CORS headers
    const newHeaders = new Headers(response.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Cache-Control", "public, max-age=86400"); // 24h cache

    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  });
}

// Route registration
// GET /proxy/7tv/:emoteId
```

---

## Phase 3: WebSocket Protocol Extension

### 3.1 New Message Types

**Add to `packages/shared/protocol.ts`:**

```typescript
// Backend → Desktop (7TV events)
export type BackendToDesktopMessage =
  | // ... existing messages
  | { type: 'seventv_emote_set'; platform: Platform; channelId: string; emotes: SevenTVEmote[] }
  | { type: 'seventv_emote_added'; platform: Platform; channelId: string; emote: SevenTVEmote }
  | { type: 'seventv_emote_removed'; platform: Platform; channelId: string; emoteId: string }
  | { type: 'seventv_emote_updated'; platform: Platform; channelId: string; emoteId: string; alias: string };

// Desktop → Backend (7TV commands)
export type DesktopToBackendMessage =
  | // ... existing messages
  | { type: 'seventv_subscribe'; platform: Platform; channelId: string }
  | { type: 'seventv_unsubscribe'; platform: Platform; channelId: string };
```

### 3.2 7TV Types

**Add to `packages/shared/types.ts`:**

```typescript
export interface SevenTVEmote {
  id: string;
  alias: string;
  name: string;
  animated: boolean;
  zeroWidth: boolean;
  aspectRatio: number;
  imageUrl: string; // Will be proxied URL
}

export interface SevenTVEmoteSet {
  id: string;
  name: string;
  channelId: string;
  platform: Platform;
  emotes: SevenTVEmote[];
}
```

---

## Phase 4: Backend Integration

### 4.1 WebSocket Handler Updates

**Modify `packages/backend/src/ws/handlers.ts`:**

```typescript
import { sevenTVManager } from "../seventv";

export async function handleWsMessage(
  ws: ServerWebSocket<WsData>,
  message: string | Buffer,
): Promise<void> {
  const data = JSON.parse(message.toString()) as DesktopToBackendMessage;

  switch (data.type) {
    // ... existing cases

    case "seventv_subscribe":
      await sevenTVManager.subscribeClient(
        ws.data.clientSecret,
        data.platform,
        data.channelId,
      );
      break;

    case "seventv_unsubscribe":
      await sevenTVManager.unsubscribeClient(
        ws.data.clientSecret,
        data.platform,
        data.channelId,
      );
      break;
  }
}

export function handleWsClose(ws: ServerWebSocket<WsData>): void {
  connectionManager.remove(ws);
  // Cleanup 7TV subscriptions for this client
  sevenTVManager.cleanupClient(ws.data.clientSecret);
}
```

### 4.2 Route Registration

**Modify `packages/backend/src/index.ts`:**

```typescript
import { handleSevenTVImageProxy } from "./seventv/image-proxy";

const server = Bun.serve<WsData>({
  // ...
  routes: {
    // ... existing routes
    "/proxy/7tv/:emoteId": (req) => handleSevenTVImageProxy(req),
  },
  // ...
});
```

---

## Phase 5: Desktop Migration

### 5.1 Desktop Architecture Changes

**Remove:**

- `packages/desktop/src/platforms/7tv/gql-client.ts` (moved to backend)
- `packages/desktop/src/platforms/7tv/event-client.ts` (moved to backend)
- `packages/desktop/src/platforms/7tv/emote-store.ts` (simplified)
- Settings `seventvUserId` field

**Keep/Simplify:**

- `packages/desktop/src/platforms/7tv/emote-parser.ts` (message parsing)

**New:**

- `packages/desktop/src/seventv/` - Client-side cache and proxy URL builder

### 5.2 Desktop Service

```typescript
// packages/desktop/src/seventv/index.ts

import { rpc } from "../shared/rpc";

interface SevenTVEmote {
  id: string;
  alias: string;
  name: string;
  animated: boolean;
  zeroWidth: boolean;
  aspectRatio: number;
  imageUrl: string;
}

class DesktopSevenTVService {
  private emotesByChannel = new Map<string, Map<string, SevenTVEmote>>(); // channelKey -> alias -> emote
  private backendUrl: string;

  constructor(backendUrl: string) {
    this.backendUrl = backendUrl;
    this.setupMessageHandlers();
  }

  private setupMessageHandlers(): void {
    // Listen for 7TV events from backend via WebSocket
    // These come through the backend connection
  }

  // Subscribe to 7TV emotes for a channel
  async subscribeToChannel(
    platform: Platform,
    channelId: string,
  ): Promise<void> {
    // Send via backend WebSocket: { type: 'seventv_subscribe', platform, channelId }
  }

  // Unsubscribe when leaving channel
  async unsubscribeFromChannel(
    platform: Platform,
    channelId: string,
  ): Promise<void> {
    // Send via backend WebSocket: { type: 'seventv_unsubscribe', platform, channelId }
  }

  // Get proxied image URL
  getImageUrl(emoteId: string, size: string = "4x"): string {
    return `${this.backendUrl}/proxy/7tv/${emoteId}?size=${size}`;
  }

  // Lookup emote by alias for a channel
  getEmote(
    platform: Platform,
    channelId: string,
    alias: string,
  ): SevenTVEmote | undefined {
    const channelKey = `${platform}:${channelId}`;
    return this.emotesByChannel.get(channelKey)?.get(alias.toLowerCase());
  }

  // Handle incoming emote set from backend
  private handleEmoteSet(data: {
    platform: Platform;
    channelId: string;
    emotes: SevenTVEmote[];
  }): void {
    const channelKey = `${data.platform}:${data.channelId}`;
    const emoteMap = new Map<string, SevenTVEmote>();

    for (const emote of data.emotes) {
      emoteMap.set(emote.alias.toLowerCase(), emote);
    }

    this.emotesByChannel.set(channelKey, emoteMap);
  }

  // Handle emote updates
  private handleEmoteAdded(data: {
    platform: Platform;
    channelId: string;
    emote: SevenTVEmote;
  }): void;
  private handleEmoteRemoved(data: {
    platform: Platform;
    channelId: string;
    emoteId: string;
  }): void;
  private handleEmoteUpdated(data: {
    platform: Platform;
    channelId: string;
    emoteId: string;
    alias: string;
  }): void;
}

export const sevenTVService = new DesktopSevenTVService(BACKEND_URL);
```

### 5.3 Emote Parser Update

**Modify `packages/desktop/src/platforms/7tv/emote-parser.ts`:**

```typescript
import { sevenTVService } from "../../seventv";

export function parseMessageWithEmotes(
  text: string,
  platform: Platform,
  channelId: string,
): ParsedEmote[] {
  const words = text.split(/\s+/);
  const emotes: ParsedEmote[] = [];
  let position = 0;

  for (const word of words) {
    const emote = sevenTVService.getEmote(platform, channelId, word);
    if (emote) {
      emotes.push({
        name: word,
        url: sevenTVService.getImageUrl(emote.id),
        positions: [{ start: position, end: position + word.length }],
        aspectRatio: emote.aspectRatio,
      });
    }
    position += word.length + 1; // +1 for space
  }

  return emotes;
}
```

---

## Phase 6: Channel Join/Leave Flow

### 6.1 Flow Diagram

```
User adds channel in Desktop
        │
        ▼
Desktop sends via WS:
{ type: "seventv_subscribe",
  platform: "kick",
  channelId: "123" }
        │
        ▼
Backend receives message
        │
        ▼
SevenTVManager.subscribeClient()
        │
        ├──► Check cache for kick:123
        │    └──► If stale/missing:
        │         └──► GQL query userByConnection(platform: KICK, platformId: "123")
        │              └──► Get emote set, cache it
        │
        ├──► Check if already subscribed to this emote_set
        │    └──► If not:
        │         └──► Find pool with capacity
        │              └──► Subscribe to emote_set.update via 7TV EventAPI
        │
        └──► Add client to subscription's interested clients
        │
        ▼
Send emote set to desktop:
{ type: "seventv_emote_set",
  platform: "kick",
  channelId: "123",
  emotes: [...] }
```

### 6.2 Unsubscribe Flow

```
User leaves channel / closes app
        │
        ▼
Desktop sends via WS:
{ type: "seventv_unsubscribe",
  platform: "kick",
  channelId: "123" }
        │
        ▼
Backend removes client from subscription
        │
        ▼
If no more clients interested in kick:123:
        │
        ▼
Unsubscribe from 7TV EventAPI for this emote_set
        │
        ▼
Optionally: Keep cache for 5 min (in case user rejoins)
```

---

## Phase 7: Configuration & Environment

### 7.1 Backend Environment Variables

```env
# 7TV Configuration
SEVENTV_GQL_ENDPOINT=https://7tv.io/v4/gql
SEVENTV_EVENT_API_URL=wss://events.7tv.io/v3
SEVENTV_MAX_POOL_WEIGHT=500
SEVENTV_CACHE_TTL_MS=300000
SEVENTV_IMAGE_CACHE_DAYS=1
```

### 7.2 Constants

**Update `packages/shared/constants.ts`:**

```typescript
// 7TV
export const SEVENTV_GQL_ENDPOINT = "https://7tv.io/v4/gql";
export const SEVENTV_EVENT_API_URL = "wss://events.7tv.io/v3";
export const SEVENTV_CDN_BASE = "https://cdn.7tv.app/emote"; // Backend only
export const SEVENTV_MAX_POOL_WEIGHT = 500;
export const SEVENTV_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
```

---

## Phase 8: Error Handling & Resilience

### 8.1 Error Scenarios

| Scenario                   | Handling                                            |
| -------------------------- | --------------------------------------------------- |
| 7TV GraphQL down           | Return stale cache if available, else empty set     |
| 7TV EventAPI disconnect    | Attempt resume with session_id, else full reconnect |
| Subscription limit reached | Create new connection pool                          |
| Rate limited (4005)        | Exponential backoff, max 30s                        |
| User not found on 7TV      | Return empty set, allow retry in 60s                |
| Invalid emote set ID       | Log error, cleanup subscription                     |

### 8.2 Reconnection Strategy

```typescript
interface ReconnectionConfig {
  maxRetries: number;
  baseDelay: number; // 1000ms
  maxDelay: number; // 30000ms
  backoffMultiplier: number; // 2
}

// Close codes from 7TV that warrant reconnection:
// 4000 - Server Error: Yes
// 4005 - Rate Limited: Maybe (with backoff)
// 4006 - Restart: Yes
// 4007 - Maintenance: Yes (with 5min delay)
// 4008 - Timeout: Yes
```

---

## Phase 9: Testing Strategy

### 9.1 Unit Tests

```typescript
// seventv/cache.test.ts
// seventv/subscription-manager.test.ts
// seventv/event-client.test.ts

describe("SevenTVCache", () => {
  test("should return stale data when GQL fails", () => {});
  test("should cleanup expired entries", () => {});
  test("should update emote in place", () => {});
});

describe("SevenTVSubscriptionManager", () => {
  test("should pool subscriptions across multiple connections", () => {});
  test("should unsubscribe from 7TV when last client leaves", () => {});
  test("should handle client disconnect cleanup", () => {});
  test("should create new pool when weight limit reached", () => {});
});
```

### 9.2 Integration Tests

- Mock 7TV GraphQL server
- Mock 7TV EventAPI WebSocket
- Test full flow: subscribe → receive emotes → update → unsubscribe

---

## Phase 10: Migration Steps

### Step 1: Backend Setup (Day 1-2)

1. Add GraphQL dependencies
2. Set up codegen
3. Introspect 7TV schema
4. Generate types

### Step 2: Backend Implementation (Day 3-5)

1. Implement GQL client layer
2. Implement cache
3. Implement EventAPI client
4. Implement subscription manager with pooling
5. Add image proxy route
6. Extend WebSocket handlers

### Step 3: Desktop Migration (Day 6-7)

1. Remove old 7TV modules
2. Implement new desktop service
3. Update emote parser
4. Integrate with channel join/leave
5. Update settings UI (remove 7TV user ID input)

### Step 4: Testing & Polish (Day 8-10)

1. Unit tests
2. Integration tests
3. Load testing (many channels, many clients)
4. Error scenario testing
5. Performance optimization

---

## Implementation Priority

### High Priority (MVP)

1. ✅ GraphQL layer with codegen
2. ✅ Backend emote cache
3. ✅ Basic EventAPI connection (single pool)
4. ✅ Subscribe/unsubscribe flow
5. ✅ Image proxy
6. ✅ Desktop migration

### Medium Priority

1. Connection pooling (multiple pools for scale)
2. Session resume on reconnection
3. Metrics/logging improvements
4. Better error messages for users

### Low Priority (Future)

1. Personal emotes support
2. 7TV cosmetics (badges, etc.)
3. Optimistic updates
4. CDN edge caching for images

---

## Open Questions

1. **Platform ID Mapping**: Confirm 7TV's platform ID format for Kick (is it channel slug, numeric ID, or something else?)

2. **Channel Key Format**: Should we use `kick:123` or `kick#123` or something else?

3. **Cache Persistence**: Should emote cache survive backend restart? (SQLite cache table?)

4. **Image Proxy Caching**: Should we cache proxied images on disk, or just rely on HTTP caching headers?

5. **Personal Emotes**: Do we want to support personal emotes (requires user authentication with 7TV)?

---

## Files to Create/Modify

### Backend

**New:**

- `packages/backend/src/seventv/client.ts`
- `packages/backend/src/seventv/codegen.ts`
- `packages/backend/src/seventv/cache.ts`
- `packages/backend/src/seventv/subscription-manager.ts`
- `packages/backend/src/seventv/event-client.ts`
- `packages/backend/src/seventv/image-proxy.ts`
- `packages/backend/src/seventv/index.ts`
- `packages/backend/src/seventv/schema.graphql`
- `packages/backend/src/seventv/queries/*.graphql`
- `packages/backend/src/seventv/gql/` (generated)

**Modify:**

- `packages/backend/package.json` (add deps)
- `packages/backend/src/index.ts` (add route)
- `packages/backend/src/ws/handlers.ts` (add message handlers)

### Shared

**Modify:**

- `packages/shared/protocol.ts` (add 7TV message types)
- `packages/shared/types.ts` (add 7TV types, remove old settings)
- `packages/shared/constants.ts` (add 7TV constants)

### Desktop

**New:**

- `packages/desktop/src/seventv/index.ts`

**Modify:**

- `packages/desktop/src/platforms/7tv/emote-parser.ts` (update to use new service)
- `packages/desktop/src/bun/index.ts` (remove old 7TV init)

**Remove:**

- `packages/desktop/src/platforms/7tv/gql-client.ts`
- `packages/desktop/src/platforms/7tv/event-client.ts`
- `packages/desktop/src/platforms/7tv/emote-store.ts`

---

## Success Criteria

- [ ] Multiple channels can have 7TV emotes simultaneously
- [ ] No hardcoded 7TV user ID required
- [ ] Emotes update in real-time via EventAPI
- [ ] Desktop clients receive only updates for channels they care about
- [ ] Backend disconnects from 7TV when no clients interested
- [ ] Image proxy works (accessible from Russia)
- [ ] Connection pooling handles >500 subscriptions
- [ ] Graceful reconnection on 7TV EventAPI disconnect
- [ ] All existing emote parsing continues to work
- [ ] Type-safe GraphQL queries via codegen
