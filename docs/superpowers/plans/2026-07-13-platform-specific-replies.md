# Platform-specific replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure a desktop chat reply is sent only to the platform that owns its parent message.

**Architecture:** Move home-composer target selection into the existing chat send-target utility. The
utility will filter enabled authenticated targets by the reply target platform, then generate the
same payload shape the RPC already accepts. `ChatInput.vue` will use this utility for both
send-button eligibility and emitted payloads, keeping non-reply multi-platform sends unchanged.

**Tech Stack:** Bun test, TypeScript, Vue 3, Electrobun RPC.

## Global Constraints

- Use Bun commands and run `bun run fix` after modifying project files.
- Reply IDs are platform-specific and must never cross platform boundaries.
- Non-reply home-chat messages retain current enabled multi-platform delivery.
- Watched-channel sends remain unchanged because they already target one platform and channel.

---

### Task 1: Select platform-safe home-chat send targets

**Files:**

- Modify: `packages/desktop/src/views/main/utils/chat-send-targets.ts`
- Modify: `packages/desktop/tests/chat-send-targets.test.ts`

**Interfaces:**

- Consumes: `ChatSendTarget`, `NormalizedChatMessage`, and the composer’s enabled-platform
  predicate.
- Produces: `createChatMessageTargets(targets, text, isEnabled, replyTarget)`, returning RPC-ready
  `{ platform, channelLogin, text, replyToMessageId? }` values.

- [ ] **Step 1: Write the failing tests**

  Add the following imports and tests to `packages/desktop/tests/chat-send-targets.test.ts`:

  ```ts
  import type { Account, NormalizedChatMessage } from '@twirchat/shared/types'
  import {
    createChatMessageTargets,
    ownChatSendTargets,
  } from '../src/views/main/utils/chat-send-targets'

  const homeTargets = [
    { channelLogin: 'justovich221337', platform: 'twitch' as const },
    { channelLogin: 'satont', platform: 'kick' as const },
  ]

  test('sends a normal message to every enabled platform', () => {
    expect(createChatMessageTargets(homeTargets, 'hello', () => true)).toEqual([
      { channelLogin: 'justovich221337', platform: 'twitch', text: 'hello' },
      { channelLogin: 'satont', platform: 'kick', text: 'hello' },
    ])
  })

  test('sends a Kick reply only to Kick', () => {
    const replyTarget: Pick<NormalizedChatMessage, 'id' | 'platform'> = {
      id: 'kick-parent',
      platform: 'kick',
    }

    expect(createChatMessageTargets(homeTargets, 'hello', () => true, replyTarget)).toEqual([
      {
        channelLogin: 'satont',
        platform: 'kick',
        replyToMessageId: 'kick-parent',
        text: 'hello',
      },
    ])
  })

  test('sends a Twitch reply only to Twitch', () => {
    const replyTarget: Pick<NormalizedChatMessage, 'id' | 'platform'> = {
      id: 'twitch-parent',
      platform: 'twitch',
    }

    expect(createChatMessageTargets(homeTargets, 'hello', () => true, replyTarget)).toEqual([
      {
        channelLogin: 'justovich221337',
        platform: 'twitch',
        replyToMessageId: 'twitch-parent',
        text: 'hello',
      },
    ])
  })
  ```

- [ ] **Step 2: Run the target-selection test to verify it fails**

  Run: `bun test packages/desktop/tests/chat-send-targets.test.ts`

  Expected: FAIL because `createChatMessageTargets` is not exported.

- [ ] **Step 3: Implement the smallest target-selection utility**

  Add this interface and function to
  `packages/desktop/src/views/main/utils/chat-send-targets.ts`:

  ```ts
  import type { Account, NormalizedChatMessage, Platform } from '@twirchat/shared/types'

  export interface ChatMessageTarget extends ChatSendTarget {
    text: string
    replyToMessageId?: string
  }

  export function createChatMessageTargets(
    targets: readonly ChatSendTarget[],
    text: string,
    isEnabled: (platform: ChatSendTarget['platform']) => boolean,
    replyTarget?: Pick<NormalizedChatMessage, 'id' | 'platform'> | null,
  ): ChatMessageTarget[] {
    return targets.flatMap((target) => {
      if (
        !isEnabled(target.platform) ||
        (replyTarget && target.platform !== replyTarget.platform)
      ) {
        return []
      }

      return [
        {
          channelLogin: target.channelLogin,
          platform: target.platform,
          text,
          ...(replyTarget ? { replyToMessageId: replyTarget.id } : {}),
        },
      ]
    })
  }
  ```

- [ ] **Step 4: Run the target-selection test to verify it passes**

  Run: `bun test packages/desktop/tests/chat-send-targets.test.ts`

  Expected: PASS with four tests, including the existing own-channel target test.

### Task 2: Route the home composer through the platform-safe target selector

**Files:**

- Modify: `packages/desktop/src/views/main/components/ChatInput.vue`
- Test: `packages/desktop/tests/chat-send-targets.test.ts`

**Interfaces:**

- Consumes: `createChatMessageTargets(sendablePlatforms.value, text, isEnabled, props.replyTarget)`.
- Produces: a `send` event with exactly the platform-safe payloads returned by the utility.

- [ ] **Step 1: Update the composer’s send eligibility**

  Replace the non-watched branch of `canSend` with:

  ```ts
  return (
    createChatMessageTargets(sendablePlatforms.value, text.value, isEnabled, props.replyTarget)
      .length > 0
  )
  ```

  This prevents a reply from being considered sendable when its source platform is unavailable.

- [ ] **Step 2: Replace inline payload construction in `send()`**

  Replace the `sendablePlatforms.value.filter(...).map(...)` expression with:

  ```ts
  const targets = createChatMessageTargets(
    sendablePlatforms.value,
    trimmed,
    isEnabled,
    props.replyTarget,
  )
  ```

  Add `createChatMessageTargets` to the existing import from `../utils/chat-send-targets`.

- [ ] **Step 3: Run the focused regression test**

  Run: `bun test packages/desktop/tests/chat-send-targets.test.ts`

  Expected: PASS; the tests prove a Kick reply has no Twitch delivery target and vice versa.

- [ ] **Step 4: Format and check the desktop package**

  Run: `bun run fix`

  Expected: formatter and auto-fixable lint pass without errors.

- [ ] **Step 5: Run verification**

  Run: `bun test packages/desktop/tests/chat-send-targets.test.ts`

  Expected: PASS with zero failures.

  Run: `bun run lint`

  Expected: exit code 0.

  Run: `bun run typecheck`

  Expected: exit code 0.

- [ ] **Step 6: Commit the implementation**

  ```bash
  git add packages/desktop/src/views/main/components/ChatInput.vue \
    packages/desktop/src/views/main/utils/chat-send-targets.ts \
    packages/desktop/tests/chat-send-targets.test.ts
  git commit -m "fix(desktop): scope replies to their platform"
  ```
