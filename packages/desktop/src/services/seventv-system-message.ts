import type { BackendToDesktopMessage } from '@twirchat/shared/protocol'
import type { NormalizedChatMessage } from '@twirchat/shared/types'

type SevenTvSystemMessage = Extract<BackendToDesktopMessage, { type: 'seventv_system_message' }>

export function buildSevenTvSystemMessage(
  message: SevenTvSystemMessage,
  identity: Pick<NormalizedChatMessage, 'id' | 'timestamp'>,
): NormalizedChatMessage {
  const base: Omit<NormalizedChatMessage, 'text'> = {
    ...identity,
    author: {
      badges: [],
      color: '#6441a5',
      displayName: '7TV',
      id: '7tv-system',
      username: '7TV',
    },
    channelId: message.channelId,
    emotes: [],
    platform: message.platform,
    type: 'system',
  }
  switch (message.action) {
    case 'set_changed':
      return { ...base, text: `Active emote set changed to «${message.setName}»` }
    case 'set_renamed':
      return { ...base, text: `Emote set «${message.oldName}» renamed to «${message.newName}»` }
    case 'set_deleted':
      return { ...base, text: `Emote set «${message.setName}» was deleted` }
    case 'added':
    case 'removed':
    case 'updated': {
      const actionText =
        message.action === 'added'
          ? 'added to'
          : message.action === 'removed'
            ? 'removed from'
            : 'renamed in'
      const oldAliasText = message.oldAlias ? ` (was ${message.oldAlias})` : ''
      const prefix = `Emote «${message.emote.alias}» `
      const placeholder = `:${message.emote.alias}:`
      return {
        ...base,
        text: `${prefix}${placeholder}${oldAliasText} ${actionText} the channel`,
        emotes: [
          {
            id: message.emote.id,
            name: message.emote.alias,
            imageUrl: message.emote.imageUrl,
            animated: message.emote.animated,
            aspectRatio: message.emote.aspectRatio,
            source: 'seventv',
            provider: 'seventv',
            zeroWidth: message.emote.zeroWidth,
            positions: [{ start: prefix.length, end: prefix.length + placeholder.length - 1 }],
          },
        ],
      }
    }
  }
}
