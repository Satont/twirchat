import type { AccountsResponse, Platform, SavedAccountsResponse } from '@twirchat/shared'

import { AccountStore, AccountSelectionError } from '../db/index.ts'
import { requireClient, json } from './utils.ts'

type Accounts = Pick<
  typeof AccountStore,
  'findAllByClient' | 'findAllSavedByClient' | 'delete' | 'setActive' | 'forget'
>
const isPlatform = (value: string): value is Platform =>
  ['twitch', 'kick', 'youtube'].includes(value)
export function createAccountRoutes(
  accounts: Accounts = AccountStore,
  authenticate = requireClient,
) {
  return {
    '/api/accounts': {
      async GET(req: Request) {
        const auth = await authenticate(req)
        if (auth instanceof Response) return auth
        const active = await accounts.findAllByClient(auth.clientSecret)
        return json({
          accounts: active.map((account) => ({
            avatarUrl: account.avatarUrl,
            connectedAt: account.createdAt.getTime(),
            displayName: account.displayName,
            platform: account.platform,
            username: account.username,
          })),
        } satisfies AccountsResponse)
      },
    },
    '/api/accounts/saved': {
      async GET(req: Request) {
        const auth = await authenticate(req)
        if (auth instanceof Response) return auth
        const saved = await accounts.findAllSavedByClient(auth.clientSecret)
        return json({
          accounts: saved.map((account) => ({
            id: account.id,
            platform: account.platform,
            platformUserId: account.platformUserId,
            username: account.username,
            displayName: account.displayName,
            avatarUrl: account.avatarUrl,
            scopes: account.scopes,
            connectedAt: account.createdAt.getTime(),
            active: account.active,
          })),
        } satisfies SavedAccountsResponse)
      },
    },
    '/api/accounts/:platform': {
      async DELETE(req: Request & { params: { platform: string } }) {
        const auth = await authenticate(req)
        if (auth instanceof Response) return auth
        const { platform } = req.params
        if (!isPlatform(platform)) return json({ error: 'Invalid platform.' }, 400)
        await accounts.delete(auth.clientSecret, platform)
        return json({ ok: true })
      },
    },
    '/api/accounts/:platform/active': {
      async PATCH(req: Request & { params: { platform: string } }) {
        const auth = await authenticate(req)
        if (auth instanceof Response) return auth
        const { platform } = req.params
        if (!isPlatform(platform)) return json({ error: 'Invalid platform.' }, 400)
        if (Number(req.headers.get('content-length')) > 4096)
          return json({ error: 'Account selection request is too large.' }, 413)
        let body: unknown
        try {
          const bytes = await req.arrayBuffer()
          if (bytes.byteLength > 4096)
            return json({ error: 'Account selection request is too large.' }, 413)
          body = JSON.parse(new TextDecoder().decode(bytes))
        } catch {
          return json({ error: 'Send a JSON object containing accountId or null.' }, 400)
        }
        if (!body || typeof body !== 'object' || !('accountId' in body))
          return json({ error: 'accountId is required; use null for anonymous mode.' }, 400)
        const { accountId } = body
        if (
          accountId !== null &&
          (typeof accountId !== 'string' || !accountId || accountId.length > 256)
        )
          return json({ error: 'Invalid accountId.' }, 400)
        try {
          await accounts.setActive(auth.clientSecret, platform, accountId)
          return json({ ok: true })
        } catch (error) {
          return error instanceof AccountSelectionError
            ? json(
                { error: 'This saved account is not available for the requested platform.' },
                404,
              )
            : json({ error: 'Could not change the active account.' }, 500)
        }
      },
    },
    '/api/accounts/saved/:accountId': {
      async DELETE(req: Request & { params: { accountId: string } }) {
        const auth = await authenticate(req)
        if (auth instanceof Response) return auth
        const { accountId } = req.params
        if (!accountId || accountId.length > 256) return json({ error: 'Invalid accountId.' }, 400)
        const removed = await accounts.forget(auth.clientSecret, accountId)
        return removed
          ? json({ ok: true })
          : json({ error: 'This saved account is not available.' }, 404)
      },
    },
  }
}
export const accountRoutes = createAccountRoutes()
