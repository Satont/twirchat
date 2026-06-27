import { AccountStore } from '../db/index.ts'
import { requireClient } from './utils.ts'
import { json } from './utils.ts'
import type {
  AccountsResponse,
  Platform,
  // @ts-ignore — false positive in tsgo for workspace packages
} from '@twirchat/shared'

export const accountRoutes = {
  '/api/accounts': {
    async GET(req: Request) {
      const auth = await requireClient(req)
      if (auth instanceof Response) {
        return auth
      }
      const accounts = await AccountStore.findAllByClient(auth.clientSecret)
      return json({
        accounts: accounts.map((a) => ({
          avatarUrl: a.avatarUrl,
          connectedAt: a.createdAt.getTime(),
          displayName: a.displayName,
          platform: a.platform as Platform,
          username: a.username,
        })),
      } satisfies AccountsResponse)
    },
  },

  '/api/accounts/:platform': {
    async DELETE(req: Request) {
      const auth = await requireClient(req)
      if (auth instanceof Response) {
        return auth
      }
      const { platform } = (req as unknown as { params: { platform: string } }).params
      await AccountStore.delete(auth.clientSecret, platform)
      return json({ ok: true })
    },
  },
} as const
