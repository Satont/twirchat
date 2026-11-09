import { expect, test } from 'bun:test'

import { buildKickAuthUrl } from '../src/auth/kick.ts'

test('Kick OAuth requests every moderation scope required by the desktop rail', () => {
  const kick = new URL(
    buildKickAuthUrl('challenge', 'state', 'http://localhost:43891/auth/callback').url,
  )

  const kickScopes = kick.searchParams.get('scope')?.split(' ') ?? []
  expect(kickScopes).toEqual(
    expect.arrayContaining(['moderation:chat_message:manage', 'moderation:ban']),
  )
})
