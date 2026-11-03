import { expect, test } from 'bun:test'

import { ChatMessage, parseTwitchMessage } from '@twurple/chat'

import { parseTwitchBadgeCatalog } from '../src/platforms/twitch/badge-data'
import {
  normalizeTwitchChatMessage,
  twitchAuthorAppearance,
} from '../src/platforms/twitch/normalize-message'
import { parseTwitchHistoryLine } from '../src/services/twitch-history'

const catalog = {
  badges: { 'subscriber/12': 'https://example.com/subscriber.png' },
  badgeMetadata: {
    'subscriber/12': { title: 'One-Year Subscriber', description: 'Subscribed for one year.' },
  },
}

test('Twitch badge catalog retains title and description while accepting older backends', () => {
  const badge = parseTwitchBadgeCatalog(catalog).get('subscriber/12')
  expect(badge).toEqual({
    id: 'subscriber/12',
    type: 'subscriber',
    text: 'One-Year Subscriber',
    description: 'Subscribed for one year.',
    imageUrl: 'https://example.com/subscriber.png',
  })
  expect(parseTwitchBadgeCatalog({ badges: catalog.badges }).get('subscriber/12')).toEqual({
    id: 'subscriber/12',
    type: 'subscriber',
    text: 'subscriber',
    imageUrl: 'https://example.com/subscriber.png',
  })
  expect(() =>
    parseTwitchBadgeCatalog({ ...catalog, badgeMetadata: { 'subscriber/12': 7 } }),
  ).toThrow()
})

test('live and history Twitch messages share canonical badge metadata with missing-badge fallback', () => {
  const badges = parseTwitchBadgeCatalog(catalog)
  const line =
    '@id=one;tmi-sent-ts=1793678400000;user-id=42;display-name=Viewer;badges=subscriber/12,moderator/1 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #channel :hello'
  const parsed = parseTwitchMessage(line)
  expect(parsed).toBeInstanceOf(ChatMessage)
  if (!(parsed instanceof ChatMessage)) throw new Error('Expected a real Twitch chat fixture')
  const live = normalizeTwitchChatMessage(parsed, badges)
  const history = parseTwitchHistoryLine(line, 'channel', badges)
  expect(history?.author.badges).toEqual(live.author.badges)
  expect(live.author.badges[0]).toBe(badges.get('subscriber/12'))
  expect(live.author.badges[1]).toEqual({ id: 'moderator/1', type: 'moderator', text: 'moderator' })
  const appearance = twitchAuthorAppearance(new Map([['badges', 'subscriber/12']]), badges)
  expect(appearance.badges[0]).toBe(live.author.badges[0])
})
