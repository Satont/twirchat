import { sevenTVService } from '../../seventv'
import type { Platform } from '@twirchat/shared'

export interface ParsedEmote {
  id: string
  name: string
  imageUrl: string
  animated: boolean
  zeroWidth: boolean
  aspectRatio: number
  start: number
  end: number
}

export interface ParsedMessage {
  text: string
  parts: ({ type: 'text'; content: string } | { type: 'emote'; emote: ParsedEmote })[]
  emotes: ParsedEmote[]
}

export function parseMessageWithEmotes(
  messageText: string,
  platform: Platform,
  channelId: string,
): ParsedMessage {
  const parts: ParsedMessage['parts'] = []
  const emotes: ParsedEmote[] = []

  const tokens = messageText.split(/(\s+)/)
  let currentPosition = 0

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      parts.push({ content: token, type: 'text' })
      currentPosition += token.length
      continue
    }

    const emote = sevenTVService.getEmote(platform, channelId, token)
    if (emote) {
      const parsedEmote: ParsedEmote = {
        animated: emote.animated,
        aspectRatio: emote.aspectRatio,
        end: currentPosition + token.length - 1,
        id: emote.id,
        imageUrl: sevenTVService.getImageUrl(emote.id),
        name: emote.name,
        start: currentPosition,
        zeroWidth: emote.zeroWidth,
      }

      parts.push({ emote: parsedEmote, type: 'emote' })
      emotes.push(parsedEmote)
    } else {
      parts.push({ content: token, type: 'text' })
    }

    currentPosition += token.length
  }

  return {
    emotes,
    parts,
    text: messageText,
  }
}

export function hasEmotes(messageText: string, platform: Platform, channelId: string): boolean {
  const tokens = messageText.split(/\s+/)
  for (const token of tokens) {
    if (sevenTVService.getEmote(platform, channelId, token)) {
      return true
    }
  }
  return false
}

export function getEmotesInMessage(
  messageText: string,
  platform: Platform,
  channelId: string,
): ParsedEmote[] {
  const emotes: ParsedEmote[] = []
  const tokens = messageText.split(/(\s+)/)
  let currentPosition = 0

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      currentPosition += token.length
      continue
    }

    const emote = sevenTVService.getEmote(platform, channelId, token)
    if (emote) {
      emotes.push({
        animated: emote.animated,
        aspectRatio: emote.aspectRatio,
        end: currentPosition + token.length - 1,
        id: emote.id,
        imageUrl: sevenTVService.getImageUrl(emote.id),
        name: emote.name,
        start: currentPosition,
        zeroWidth: emote.zeroWidth,
      })
    }

    currentPosition += token.length
  }

  return emotes
}
