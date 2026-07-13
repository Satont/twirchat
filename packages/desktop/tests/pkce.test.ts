import { describe, expect, test } from 'bun:test'
import { generateCodeChallenge, generateCodeVerifier, generateState } from '@desktop/auth/pkce'
import { createHash } from 'node:crypto'

describe('PKCE utilities', () => {
  test('generateCodeVerifier returns base64url string of ~86 chars', () => {
    const verifier = generateCodeVerifier()
    // 64 bytes = ~86 base64url characters
    expect(verifier.length).toBeGreaterThan(80)
    // Base64url: no +, /, =
    expect(verifier).not.toMatch(/[+/=]/)
  })

  test('generateCodeChallenge returns SHA-256 base64url of verifier', () => {
    const verifier = generateCodeVerifier()
    const challenge = generateCodeChallenge(verifier)

    // Verify manually
    const expected = createHash('sha256').update(verifier).digest('base64url')
    expect(challenge).toBe(expected)
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
