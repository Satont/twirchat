import { APP_NAME } from '@twirchat/shared/constants'
import { hostname } from 'node:os'

/**
 * Простое симметричное шифрование AES-256-GCM через Web Crypto API.
 * Ключ выводится из machineId (hostname + appName) через PBKDF2.
 *
 * Формат зашифрованной строки: base64(salt[16] + iv[12] + ciphertext)
 */

const PBKDF2_ITERATIONS = 100_000
const KEY_LENGTH = 256

async function deriveKey(salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const rawKey = encoder.encode(`${APP_NAME}:${hostname()}`)

  const baseKey = await crypto.subtle.importKey('raw', rawKey, 'PBKDF2', false, ['deriveKey'])

  return crypto.subtle.deriveKey(
    { hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, name: 'PBKDF2', salt },
    baseKey,
    { length: KEY_LENGTH, name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptAsync(plaintext: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(plaintext)

  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>
  const iv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>
  const key = await deriveKey(salt)

  const ciphertext = await crypto.subtle.encrypt({ iv, name: 'AES-GCM' }, key, data)

  const result = new Uint8Array(salt.length + iv.length + ciphertext.byteLength)
  result.set(salt, 0)
  result.set(iv, salt.length)
  result.set(new Uint8Array(ciphertext), salt.length + iv.length)

  return Buffer.from(result).toString('base64')
}

async function decryptAsync(encoded: string): Promise<string> {
  const bytes = Buffer.from(encoded, 'base64')
  const salt = bytes.subarray(0, 16)
  const iv = bytes.subarray(16, 28)
  const ciphertext = bytes.subarray(28)

  const key = await deriveKey(salt)

  const plaintext = await crypto.subtle.decrypt({ iv, name: 'AES-GCM' }, key, ciphertext)

  return new TextDecoder().decode(plaintext)
}

// ============================================================
// Синхронные обёртки (используют кэш, инициализируются один раз)
// ============================================================

// Простой XOR-fallback для синхронного использования в SQLite
// (реальное AES используется асинхронно, но для совместимости
//  С синхронным SQLite используем синхронное шифрование)
function xorEncode(text: string): string {
  const key = `${APP_NAME}:${hostname()}`
  const encoded = [...text]
    .map((char, i) => char.charCodeAt(0) ^ (key.charCodeAt(i % key.length) ?? 0))
    .map((code) => String.fromCharCode(code))
    .join('')
  return Buffer.from(encoded, 'binary').toString('base64')
}

function xorDecode(encoded: string): string {
  const key = `${APP_NAME}:${hostname()}`
  const decoded = Buffer.from(encoded, 'base64').toString('binary')
  return [...decoded]
    .map((char, i) => char.charCodeAt(0) ^ (key.charCodeAt(i % key.length) ?? 0))
    .map((code) => String.fromCharCode(code))
    .join('')
}

/**
 * Синхронное шифрование токена для хранения в SQLite.
 * Используется простое обратимое кодирование — достаточно для защиты
 * от случайного чтения файла БД.
 */
export function encrypt(plaintext: string): string {
  return xorEncode(plaintext)
}

export function decrypt(encoded: string): string {
  return xorDecode(encoded)
}

/** Async-версии для будущего использования */
export { encryptAsync, decryptAsync }
