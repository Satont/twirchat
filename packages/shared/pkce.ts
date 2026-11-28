import { createHash, randomBytes } from 'node:crypto'

export function generateCodeVerifier(): string {
  return randomBytes(64).toString('base64url')
}

export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function generateState(): string {
  return randomBytes(16).toString('hex')
}
