import { expect, test } from 'bun:test'
import { buildKickAuthUrl } from '../src/auth/kick.ts'
import { buildTwitchAuthUrl } from '../src/auth/twitch.ts'

test('OAuth URLs request every moderation scope required by the desktop rail', () => {
  const twitch = new URL(
    buildTwitchAuthUrl('challenge', 'state', 'http://localhost:43891/auth/callback').url,
  )
  const kick = new URL(
    buildKickAuthUrl('challenge', 'state', 'http://localhost:43891/auth/callback').url,
  )

  const twitchScopes = twitch.searchParams.get('scope')?.split(' ') ?? []
  expect(twitchScopes).toEqual(
    expect.arrayContaining([
      'moderator:read:moderators',
      'moderator:read:chatters',
      'moderator:manage:chat_messages',
      'moderator:manage:banned_users',
    ]),
  )

  const kickScopes = kick.searchParams.get('scope')?.split(' ') ?? []
  expect(kickScopes).toEqual(
    expect.arrayContaining(['moderation:chat_message:manage', 'moderation:ban']),
  )
})
