import type { Badge, NormalizedEvent } from '../types'
import type { YouTubeChatBatch } from '../youtube-chat'
import type { LiveChatMessageListResponse } from './gen/stream_list'

function remember<T>(map: Map<string, T>, key: string, value: T): void {
  map.set(key, value)
  if (map.size > 10000) {
    const oldest = map.keys().next()
    if (!oldest.done) map.delete(oldest.value)
  }
}

export function createYouTubeChatNormalizer({ channelId }: { channelId: string }) {
  const seen = new Map<string, string>()
  const combos = new Map<string, number>()
  return {
    normalize(response: LiveChatMessageListResponse): YouTubeChatBatch {
      const batch: YouTubeChatBatch = { messages: [], events: [], moderation: [] }
      if (response.offlineAt) batch.ended = true
      for (const item of [
        ...response.items,
        ...(response.activePollItem ? [response.activePollItem] : []),
      ]) {
        const snippet = item.snippet
        if (!item.id || !snippet) continue
        const id = `youtube:${item.id}`
        const fingerprint = JSON.stringify(snippet)
        if (seen.get(id) === fingerprint) continue
        if (seen.has(id) && snippet.type !== 21 && snippet.type !== 20) continue
        remember(seen, id, fingerprint)
        const details = item.authorDetails
        const user = {
          id: details?.channelId || snippet.authorChannelId || '',
          displayName: details?.displayName ?? '',
          avatarUrl: details?.profileImageUrl,
        }
        const timestamp = new Date(snippet.publishedAt || Date.now())
        if (Number.isNaN(timestamp.getTime())) continue
        const badges: Badge[] = []
        if (details?.isChatOwner) badges.push({ id: 'owner', type: 'broadcaster', text: 'Owner' })
        if (details?.isChatModerator)
          badges.push({ id: 'mod', type: 'moderator', text: 'Moderator' })
        if (details?.isChatSponsor)
          badges.push({ id: 'member', type: 'subscriber', text: 'Member' })
        if (details?.isVerified) badges.push({ id: 'verified', type: 'staff', text: 'Verified' })
        const text =
          snippet.textMessageDetails?.messageText ||
          snippet.displayMessage ||
          (snippet.pollDetails?.metadata
            ? [
                snippet.pollDetails.metadata.questionText,
                ...snippet.pollDetails.metadata.options.map(
                  (option) => `${option.optionText} (${option.tally ?? 0})`,
                ),
              ].join(' · ')
            : '')
        const event = (
          type: NormalizedEvent['type'],
          data: Record<string, unknown>,
          eventId = id,
        ) =>
          batch.events.push({
            id: eventId,
            platform: 'youtube',
            type,
            user,
            timestamp,
            data: { channelId, ...data },
          })
        if (snippet.type === 4) {
          batch.ended = true
          continue
        }
        const deleted =
          snippet.messageDeletedDetails?.deletedMessageId ||
          snippet.messageRetractedDetails?.retractedMessageId
        if (deleted) {
          batch.moderation.push({
            platform: 'youtube',
            channelId,
            action: 'delete_message',
            messageId: `youtube:${deleted}`,
          })
          continue
        }
        if (snippet.userBannedDetails) {
          const ban = snippet.userBannedDetails
          batch.moderation.push({
            platform: 'youtube',
            channelId,
            action: ban.banType === 2 ? 'timeout' : 'ban',
            targetUserId: ban.bannedUserDetails?.channelId,
            durationSeconds: ban.banDurationSeconds,
          })
          continue
        }
        const paid = snippet.superChatDetails ?? snippet.superStickerDetails
        if (paid) {
          event('superchat', {
            amount: (paid.amountMicros ?? 0) / 1000000,
            amountDisplayString: paid.amountDisplayString,
            currency: paid.currency,
            comment: snippet.superChatDetails?.userComment,
            sticker: Boolean(snippet.superStickerDetails),
            stickerMetadata: snippet.superStickerDetails?.superStickerMetadata,
            tier: paid.tier,
          })
          continue
        }
        if (snippet.giftDetails) {
          const gift = snippet.giftDetails
          const total = Math.max(1, gift.comboCount ?? 1)
          const previous = combos.get(id) ?? 0
          if (total <= previous) continue
          remember(combos, id, total)
          event(
            'superchat',
            {
              gift: true,
              giftName: gift.giftName,
              giftUrl: gift.giftUrl,
              altText: gift.altText,
              jewels: gift.jewelsAmount,
              count: total - previous,
              comboCount: total,
            },
            `${id}:combo:${total}`,
          )
          continue
        }
        if (snippet.membershipGiftingDetails) {
          event('gift_sub', {
            count: snippet.membershipGiftingDetails.giftMembershipsCount,
            level: snippet.membershipGiftingDetails.giftMembershipsLevelName,
          })
          continue
        }
        if (
          snippet.newSponsorDetails ||
          snippet.memberMilestoneChatDetails ||
          snippet.giftMembershipReceivedDetails
        ) {
          event('membership', {
            ...snippet.newSponsorDetails,
            ...snippet.memberMilestoneChatDetails,
            ...snippet.giftMembershipReceivedDetails,
            gifted: Boolean(snippet.giftMembershipReceivedDetails),
          })
          continue
        }
        if (snippet.type === 2) continue
        if (text)
          batch.messages.push({
            id,
            platform: 'youtube',
            channelId,
            author: { ...user, badges },
            text,
            emotes: [],
            timestamp,
            type: snippet.type === 1 ? 'message' : 'system',
          })
      }
      return batch
    },
  }
}
