import { z } from 'zod'

import { ObsRemoteSession, type ObsRemoteSnapshot } from '../../services/obs-remote'
import { decryptAsync, encryptAsync } from '../../store/crypto'
import { getDb } from '../../store/db'
import { t } from '../i18n'

const CONNECTIONS_KEY = 'secret:obs-remote-connections'
const MAX_CONNECTIONS = 32

const profileName = z
  .string()
  .trim()
  .min(1, { error: () => t('misc.obsRemoteProfiles.nameRequired') })
  .max(80)
const endpoint = z
  .string()
  .trim()
  .min(1, { error: () => t('misc.obsRemoteProfiles.addressRequired') })
  .max(2048)
  .transform((value, ctx) => {
    const url = URL.parse(value)
    if (
      !url ||
      (url.protocol !== 'ws:' && url.protocol !== 'wss:') ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash
    ) {
      ctx.addIssue({
        code: 'custom',
        message: t('misc.obsRemoteProfiles.addressInvalid'),
      })
      return z.NEVER
    }
    return url.href
  })

const storedProfile = z.object({
  id: z.uuid(),
  name: profileName,
  url: endpoint,
  secret: z.string().min(1).optional(),
})
const profileList = z.array(storedProfile).max(MAX_CONNECTIONS)
type StoredProfile = z.infer<typeof storedProfile>

function parseAddress(address: string): { url: string; password?: string } {
  const value = address.trim()
  if (/^obswss?:\/\//iu.test(value)) {
    const link = URL.parse(value)
    if (!link?.host || link.username || link.password || link.search || link.hash)
      throw new Error(t('misc.obsRemoteProfiles.invalidLink'))
    try {
      const protocol = link.protocol === 'obswss:' ? 'wss:' : 'ws:'
      return {
        url: endpoint.parse(`${protocol}//${link.host}`),
        password: link.pathname.length > 1 ? decodeURIComponent(link.pathname.slice(1)) : undefined,
      }
    } catch {
      throw new Error(t('misc.obsRemoteProfiles.invalidLink'))
    }
  }
  const candidate =
    value && !value.includes('://') ? `ws${value.endsWith(':443') ? 's' : ''}://${value}` : value
  const parsed = endpoint.safeParse(candidate)
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? t('misc.obsRemoteProfiles.invalidAddress'))
  return { url: parsed.data }
}

export interface ObsRemoteProfile {
  id: string
  name: string
  url: string
  hasPassword: boolean
}

export interface ObsRemoteProfileDraft {
  id?: string
  name: string
  url: string
  password?: string
}

export type ObsRemoteConnection = Pick<
  ObsRemoteSession,
  'connect' | 'dispose' | 'run' | 'preview' | 'setMetering'
>

function readProfiles(): StoredProfile[] {
  const row = getDb()
    .query<{ value: string }, [string]>('SELECT value FROM client_identity WHERE key = ?')
    .get(CONNECTIONS_KEY)
  if (!row) return []
  try {
    return profileList.parse(JSON.parse(row.value))
  } catch {
    throw new Error(t('misc.obsRemoteProfiles.readFailed'))
  }
}

function saveProfiles(profiles: StoredProfile[]): ObsRemoteProfile[] {
  getDb().run(
    'INSERT INTO client_identity (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [CONNECTIONS_KEY, JSON.stringify(profiles)],
  )
  return profiles.map(publicProfile)
}

function publicProfile({ id, name, url, secret }: StoredProfile): ObsRemoteProfile {
  return { id, name, url, hasPassword: secret !== undefined }
}

export const obsRemoteApi = {
  parseAddress,

  async list(): Promise<ObsRemoteProfile[]> {
    return readProfiles().map(publicProfile)
  },

  async save(draft: ObsRemoteProfileDraft): Promise<ObsRemoteProfile[]> {
    const name = profileName.safeParse(draft.name)
    if (!name.success)
      throw new Error(name.error.issues[0]?.message ?? t('misc.obsRemoteProfiles.invalidName'))
    const address = parseAddress(draft.url)
    const password = address.password ?? draft.password
    if (password !== undefined && password.length > 4096)
      throw new Error(t('misc.obsRemoteProfiles.passwordTooLong'))
    const secret = password ? await encryptAsync(password) : undefined
    const profiles = readProfiles()
    const index = profiles.findIndex((profile) => profile.id === draft.id)
    if (draft.id !== undefined && index === -1) throw new Error(t('misc.obsRemoteProfiles.removed'))
    if (index === -1 && profiles.length >= MAX_CONNECTIONS)
      throw new Error(t('misc.obsRemoteProfiles.maxConnections', { max: MAX_CONNECTIONS }))
    const profile = {
      id: draft.id ?? crypto.randomUUID(),
      name: name.data,
      url: address.url,
      secret: password === undefined ? profiles[index]?.secret : secret,
    }
    if (index === -1) profiles.push(profile)
    else profiles[index] = profile
    return saveProfiles(profiles)
  },

  async remove(id: string): Promise<ObsRemoteProfile[]> {
    return saveProfiles(readProfiles().filter((profile) => profile.id !== id))
  },

  async createSession(
    id: string,
    publish: (snapshot: ObsRemoteSnapshot) => void,
  ): Promise<ObsRemoteConnection> {
    const profile = readProfiles().find((entry) => entry.id === id)
    if (!profile) throw new Error(t('misc.obsRemoteProfiles.removed'))
    const password = profile.secret
      ? await decryptAsync(profile.secret).catch(() => {
          throw new Error(t('misc.obsRemoteProfiles.readPasswordFailed'))
        })
      : ''
    return new ObsRemoteSession(profile.url, password, publish)
  },
}
