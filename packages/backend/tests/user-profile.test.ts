import { describe, expect, test } from 'bun:test'

import { createUserProfileService } from '../src/api/user-profile'
import { literal, required } from './literal'

function fixture(failSection = '') {
  const calls: { url: URL; init?: RequestInit }[] = []
  async function request(url: string, init?: RequestInit) {
    const parsed = new URL(url)
    calls.push({ url: parsed, init })
    if (parsed.pathname.includes(failSection) && failSection)
      return new Response('', { status: 403 })
    if (parsed.pathname === '/helix/users')
      return Response.json({
        data: [
          {
            id: parsed.searchParams.has('login') ? '100' : '200',
            login: 'viewer',
            display_name: 'Viewer',
            profile_image_url: 'https://example.org/avatar.png',
            description: 'Bio',
            broadcaster_type: 'affiliate',
          },
        ],
      })
    if (parsed.pathname === '/helix/streams')
      return Response.json({
        data: [
          {
            title: 'Live stream',
            game_name: 'Game',
            viewer_count: 10,
            started_at: '2026-11-02T10:00:00Z',
          },
        ],
      })
    if (parsed.pathname === '/helix/videos')
      return Response.json({ data: [{ created_at: '2026-11-01T10:00:00Z' }] })
    if (parsed.pathname === '/helix/chat/color')
      return Response.json({ data: [{ color: '#123456' }] })
    if (parsed.pathname === '/v1/users/viewer')
      return Response.json({ pronoun_id: 'hehim', alt_pronoun_id: 'theythem' })
    if (parsed.pathname === '/v1/pronouns')
      return Response.json({
        hehim: { subject: 'He', object: 'Him' },
        theythem: { subject: 'They', object: 'Them' },
      })
    if (parsed.pathname === '/namehistory/200')
      return Response.json([
        { user_login: 'oldname', first_timestamp: '2020-01-01', last_timestamp: '2023-01-01' },
        { user_login: 'viewer', first_timestamp: '2023-01-02', last_timestamp: '2026-11-01' },
      ])
    throw new Error(`Unexpected source ${parsed}`)
  }
  return { calls, service: createUserProfileService({ fetch: request, helix: request }) }
}
const input = {
  platform: literal('twitch'),
  platformUserId: '200',
  channelSlug: 'creator',
}
describe('user profile sources', () => {
  test('normalizes public live, pronoun, observed name and role sources', async () => {
    const { service, calls } = fixture()
    const result = await service(input)
    expect(result).toMatchObject({
      id: '200',
      login: 'viewer',
      pronouns: 'He/Him / They/Them',
      roles: { broadcaster: false },
      live: { title: 'Live stream', viewers: 10 },
      lastLive: '2026-11-01T10:00:00Z',
    })
    expect(result.errors.map(({ section }) => section).toSorted()).toEqual(['followers', 'roles'])
    expect(result.nameHistory?.map((entry) => entry.login)).toEqual(['viewer', 'oldname'])
    expect(
      required(calls.find((call) => call.url.hostname === 'logs.zonian.dev')).init?.headers,
    ).toBeUndefined()
    expect(
      required(calls.find((call) => call.url.hostname === 'api.pronouns.alejo.io')).init?.headers,
    ).toBeUndefined()
  })
  test('partial source failure preserves other data and does not invent an offline state', async () => {
    const { service } = fixture('/helix/streams')
    const result = await service(input)
    expect(result.live).toBeUndefined()
    expect(result.color).toBe('#123456')
    expect(result.errors).toContainEqual({ section: 'live', message: 'Source returned HTTP 403.' })
  })
  test('validates numeric IDs before external requests', async () => {
    const { service, calls } = fixture()
    await expect(service({ ...input, platformUserId: '../secret' })).rejects.toThrow('numeric')
    expect(calls).toHaveLength(0)
  })
})
