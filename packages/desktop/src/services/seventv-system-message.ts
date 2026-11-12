import type { BackendToDesktopMessage } from '@twirchat/shared/protocol'
import type { NormalizedChatMessage } from '@twirchat/shared/types'

import { t } from '../gpuix/i18n'

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
    metadata: {
      sevenTvAction:
        message.action === 'added' || message.action === 'removed' ? message.action : 'changed',
    },
    platform: message.platform,
    type: 'system',
  }
  switch (message.action) {
    case 'set_changed':
      return {
        ...base,
        text: t('notices.seventv.setChanged', { name: message.setName }),
      }
    case 'set_renamed':
      return {
        ...base,
        text: t('notices.seventv.setRenamed', {
          oldName: message.oldName,
          newName: message.newName,
        }),
      }
    case 'set_deleted':
      return {
        ...base,
        text: t('notices.seventv.setDeleted', { name: message.setName }),
      }
    case 'added':
    case 'removed':
    case 'updated': {
      const actionKey =
        message.action === 'added'
          ? 'notices.seventv.emoteAdded'
          : message.action === 'removed'
            ? 'notices.seventv.emoteRemoved'
            : 'notices.seventv.emoteUpdated'
      const was = message.oldAlias ? t('notices.seventv.wasAlias', { alias: message.oldAlias }) : ''
      const prefix = t('notices.seventv.emotePrefix', { alias: message.emote.alias })
      const placeholder = `:${message.emote.alias}:`
      const attribution = message.actorName
        ? t('notices.seventv.actorSuffix', { actor: message.actorName })
        : ''
      return {
        ...base,
        text: t(actionKey, { prefix, placeholder, was }) + attribution,
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
