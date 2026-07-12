import { createHash, randomBytes } from 'node:crypto'

/**
 * Генерирует code_verifier (64 случайных байта, base64url без паддинга)
 */
export function generateCodeVerifier(): string {
  return randomBytes(64).toString('base64url')
}

/**
 * Вычисляет code_challenge из code_verifier (SHA-256, base64url)
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/**
 * Генерирует случайный state для защиты от CSRF
 */
export function generateState(): string {
  return randomBytes(16).toString('hex')
}
