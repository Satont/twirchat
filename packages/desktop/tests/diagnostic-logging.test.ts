import { expect, test } from 'bun:test'

import { formatDiagnosticLog } from '../src/services/diagnostic-logging'

test('diagnostic files keep structured account outcomes and omit free-form details', () => {
  const ts = '2026-11-12T00:00:00.000Z'
  const line = formatDiagnosticLog({
    level: 'warn',
    module: 'auth-twitch',
    msg: 'Account authorization ended',
    ts,
    meta: {
      accountId: 'twitch:123',
      accessToken: 'secret',
      error: 'Provider response containing private data',
      platform: 'twitch',
      reason: 'invalid_refresh_token',
      status: 401,
      url: 'http://localhost/?state=private',
    },
  })

  expect(JSON.parse(line)).toEqual({
    level: 'warn',
    module: 'auth-twitch',
    msg: 'Account authorization ended',
    ts,
    platform: 'twitch',
    reason: 'invalid_refresh_token',
    status: 401,
  })
  expect(line.endsWith('\n')).toBe(true)
})
