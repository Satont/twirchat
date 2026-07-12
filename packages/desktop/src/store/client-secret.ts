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
  const row = db
    .query<{ value: string }, [string]>('SELECT value FROM client_identity WHERE key = ?')
    .get(SECRET_KEY)

  if (row) {
    return row.value
  }

  const secret = randomUUID()
  db.run('INSERT INTO client_identity (key, value) VALUES (?, ?)', [SECRET_KEY, secret])
  log.info(`Generated new client secret: ${secret.slice(0, 8)}...`)
  return secret
}
