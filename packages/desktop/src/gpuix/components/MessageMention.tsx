import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { useEffect, useRef } from 'react'

import type { UserCardTarget } from '../../views/main/utils/chatCommands'
import { resolveMentionTarget } from '../../views/main/utils/mention-user-card'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import type { MessageToken } from '../message-tokens'
import { accountsStore, aliasesStore, homeMessagesStore, watchedMessagesStore } from '../state/app'
import { useDesktopWindows } from '../state/desktop-windows'
import { readableOn } from '../theme'
import { useFont, useTheme } from '../theme-context'

type OpenUserCard = (target: UserCardTarget) => void

interface MentionRequest {
  message: NormalizedChatMessage
  username: string
}

const pendingCards = new WeakMap<object, MentionRequest>()

interface MessageMentionProps {
  token: Extract<MessageToken, { kind: 'mention' }>
  message: NormalizedChatMessage
  channelSlug?: string
  onOpenUserCard?: OpenUserCard
  fontSize: number
  baseColor: string
  opacity: number
}

function* retainedMessages(message: NormalizedChatMessage): Generator<NormalizedChatMessage> {
  const groups = watchedMessagesStore.get()
  for (const entries of groups.values()) {
    for (let index = entries.length - 1; index >= 0; index--) {
      const known = entries[index]
      if (known?.platform === message.platform && known.channelId === message.channelId) yield known
    }
  }
  yield* homeMessagesStore.get()
  for (const entries of groups.values()) yield* entries
}

export function MessageMention({
  token,
  message,
  channelSlug,
  onOpenUserCard,
  fontSize,
  baseColor,
  opacity,
}: MessageMentionProps) {
  const backend = useBackend()
  const theme = useTheme()
  const font = useFont()
  const windows = useDesktopWindows()
  const interactive = Boolean(onOpenUserCard || windows)
  const username = token.username
  const pending = useRef<MentionRequest | null>(null)
  useEffect(
    () => () => {
      if (pending.current?.message === message && pending.current.username === username)
        pending.current = null
    },
    [message, username],
  )

  async function openCard(): Promise<void> {
    const destination = onOpenUserCard ?? windows
    if (!destination) return
    const request = { message, username }
    pending.current = request
    pendingCards.set(destination, request)
    try {
      const target = await resolveMentionTarget({
        message,
        username,
        channelSlug,
        accounts: accountsStore.get(),
        messages: retainedMessages(message),
        resolveUser: (input) => backend.api.resolveMentionUser(input),
      })
      if (pending.current !== request || pendingCards.get(destination) !== request) return
      target.currentAlias = aliasesStore
        .get()
        .find(
          (alias) =>
            alias.platform === target.platform && alias.platformUserId === target.platformUserId,
        )?.alias
      if (onOpenUserCard) onOpenUserCard(target)
      else if (windows) await windows.openUser(target)
    } finally {
      if (pending.current === request) pending.current = null
      if (pendingCards.get(destination) === request) pendingCards.delete(destination)
    }
  }

  return (
    <text
      tabIndex={interactive ? 0 : undefined}
      onClick={(event) => {
        if (!interactive || (event.button ?? 0) !== 0 || event.isRightClick) return
        runUiTask(openCard())
      }}
      onKeyDown={(event) => {
        if (interactive && (event.key === 'enter' || event.key === 'space')) {
          event.preventDefault()
          event.stopPropagation()
          runUiTask(openCard())
        }
      }}
      style={{
        color: token.color ? readableOn(token.color, theme.bg) : baseColor,
        fontWeight: token.color ? 600 : 400,
        fontSize,
        fontFamily: font,
        cursor: interactive ? 'pointer' : 'default',
        lineHeight: Math.round(fontSize * 1.45),
        opacity,
      }}
    >
      {token.text}
    </text>
  )
}
