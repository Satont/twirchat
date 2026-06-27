import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import { logger } from '@twirchat/shared/logger'

const log = logger('client-secret')

const SECRET_KEY = 'client_secret'

/**
 * Returns the persistent UUID that identifies this desktop installation.
 * Generated once and stored in SQLite; passed as X-Client-Secret to backend.
 */
export function getClientSecret(): string {
  const db = getDb()
  const row = db.prepare('SELECT value FROM client_identity WHERE key = ?').get(SECRET_KEY) as
    | { value: string }
    | undefined

  if (row) {
    return row.value
  }

  const secret = randomUUID()
  db.prepare('INSERT INTO client_identity (key, value) VALUES (?, ?)').run(SECRET_KEY, secret)
  log.info(`Generated new client secret: ${secret.slice(0, 8)}...`)
  return secret
}
