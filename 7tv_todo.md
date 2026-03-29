# 7TV Emotes Integration - Implementation Plan

## Overview
Add 7TV emotes support to TwirChat using EventAPI for real-time updates and GQL API for initial data fetching.

## Architecture

### 1. Settings Configuration
- Add `seventvUserId` field to AppSettings (optional string)
- Add input field in SettingsPanel for 7TV User ID
- Example ID format: `01JDJXEGCV1FFGDXAR0Z9E86NY`

### 2. GQL API Client (7TV GQL)
**File:** `packages/desktop/src/platforms/7tv/gql-client.ts`

**Queries needed:**
- Get user by ID with active emote set
- Get emote set by ID with all emotes

**Types:**
```typescript
interface SevenTVEmote {
  id: string;
  name: string;
  alias: string;
  animated: boolean;
  images: Array<{
    url: string;
    mime: string;
    size: number;
    scale: number;
  }>;
}

interface SevenTVEmoteSet {
  id: string;
  name: string;
  emotes: SevenTVEmote[];
}

interface SevenTVUser {
  id: string;
  style: {
    activeEmoteSetId: string | null;
    activeEmoteSet: SevenTVEmoteSet | null;
  };
}
```

### 3. EventAPI Client (SSE)
**File:** `packages/desktop/src/platforms/7tv/event-client.ts`

**Connection URL:** `https://events.7tv.io/v3?channel=<user_id>`

**Event Types to Handle:**

#### User Events:
- `user.update` - User data changes
  - Check if `activeEmoteSetId` changed
  - If changed: unsubscribe from old set, subscribe to new set

#### EmoteSet Events:
- `emote_set.update` - Emote set modified
  - `EventEmoteSetDataAddEmote` - New emote added
  - `EventEmoteSetDataRemoveEmote` - Emote removed
  - `EventEmoteSetDataRenameEmote` - Emote renamed (alias changed)

#### Emote Events:
- `emote.update` - Emote data changed (name, flags, etc.)

### 4. Emote Store/Cache
**File:** `packages/desktop/src/platforms/7tv/emote-store.ts`

**Responsibilities:**
- Store emote data in memory (Map: alias -> emote data)
- Provide lookup function: `findEmote(alias: string): SevenTVEmote | undefined`
- Handle updates from EventAPI
- Clear cache on disconnect

### 5. Message Parser Integration
**File:** `packages/desktop/src/chat/emote-parser.ts`

**Function:**
```typescript
function parseEmotes(text: string, emoteStore: EmoteStore): ParsedMessage {
  // Split text by emote aliases
  // Return array of text segments and emote objects
}
```

**Integration points:**
- Call from chat aggregator before displaying message
- Replace `:emoteName:` or `emoteName` patterns with emote data

### 6. UI Components

#### ChatMessage.vue updates:
- Render emotes as `<img>` tags
- Support animated (WEBP) and static (AVIF) formats
- Size: 28px height (adjustable via CSS)
- Use CDN URL: `https://cdn.7tv.app/emote/{id}/4x.webp`

#### SettingsPanel.vue updates:
- Add "7TV Integration" section
- Input field for 7TV User ID
- Connection status indicator
- "Reconnect" button

### 7. Lifecycle Management

**On App Start (if 7TV User ID configured):**
1. Fetch user data via GQL
2. Get active emote set
3. Load all emotes from set into store
4. Connect to EventAPI
5. Subscribe to user channel events
6. Subscribe to emote set events

**On User ID Change:**
1. Disconnect current EventAPI connection
2. Clear emote store
3. Re-run initialization

**On Active Emote Set Change (via EventAPI):**
1. Unsubscribe from old set events
2. Fetch new emote set data
3. Replace emote store contents
4. Subscribe to new set events

**On Emote Set Update (add/remove/rename):**
1. Update emote store accordingly
2. No need to refetch entire set

### 8. Error Handling
- GQL fetch failures: Retry with exponential backoff
- EventAPI disconnect: Auto-reconnect after 5s
- Invalid User ID: Show error in settings
- Network issues: Queue updates, apply on reconnect

### 9. Overlay Support
- Overlay always uses Inter font (no 7TV emotes for now)
- Future: Can add emote support to overlay via URL params

## Implementation Order

1. **GQL Client** - Basic query for user + emote set
2. **Emote Store** - In-memory storage with lookup
3. **Settings UI** - Add 7TV User ID field
4. **EventAPI Client** - SSE connection with event handlers
5. **Integration** - Connect to chat message flow
6. **UI Rendering** - Display emotes in chat
7. **Testing** - Verify live updates work

## API Endpoints

**GQL:** `https://7tv.io/v4/gql`

**EventAPI:** `https://events.7tv.io/v3`

**CDN:** `https://cdn.7tv.app/emote/{id}/{size}.{format}`
- Sizes: 1x, 2x, 3x, 4x
- Formats: webp, avif

## Notes
- Use WEBP format for better browser support
- Cache emote images in browser (natural HTTP caching)
- Don't store emote images locally, always use CDN
- Handle zero-width emotes (overlay support)
- Respect emote flags (animated, nsfw, etc.)
