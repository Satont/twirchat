import { describe, expect, test } from 'bun:test'

import { generateCodeChallenge, generateCodeVerifier, generateState } from '@twirchat/shared/pkce'

describe('PKCE utilities', () => {
  test('generates an unpadded base64url verifier from 64 bytes', () => {
    expect(generateCodeVerifier()).toMatch(/^[A-Za-z0-9_-]{86}$/u)
  })

  test('matches the RFC 7636 S256 example', () => {
    expect(generateCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  test('generateState returns hex string of 32 chars', () => {
    const state = generateState()
    expect(state.length).toBe(32)
    expect(state).toMatch(/^[0-9a-f]+$/)
  })

  test('each call generates unique values', () => {
    const v1 = generateCodeVerifier()
    const v2 = generateCodeVerifier()
    expect(v1).not.toBe(v2)

    const s1 = generateState()
    const s2 = generateState()
    expect(s1).not.toBe(s2)
  })
})
