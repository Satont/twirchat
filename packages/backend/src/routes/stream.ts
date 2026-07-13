import { handleStreamStatus } from '../api/stream-status.ts'
import { handleUpdateStream } from '../api/update-stream.ts'
import { handleSearchCategories } from '../api/search-categories.ts'
import { handleTwitchBadges } from '../api/twitch-badges.ts'
import { fetchTwitchUserById } from '../api/twitch-users.ts'
import { handleChannelsStatus, InvalidChannelsStatusRequestError } from '../api/channels-status.ts'
import { handleKickChatroom } from '../api/kick-chatroom.ts'
import { handleTwitchSendMessage } from '../api/twitch-send-message.ts'
import { json, requireClient } from './utils.ts'
import { logger } from '@twirchat/shared/logger'

const log = logger('routes')
const MAX_ERROR_LOG_LENGTH = 300

export const streamRoutes = {
  '/api/channels-status': {
    async POST(req: Request) {
      const auth = await requireClient(req)
      if (auth instanceof Response) return auth
      try {
        const result = await handleChannelsStatus(req)
        return json(result)
      } catch (err) {
        if (err instanceof InvalidChannelsStatusRequestError) {
          return json({ error: err.message }, 400)
        }

        log.error('channels-status failed', { err: String(err).slice(0, MAX_ERROR_LOG_LENGTH) })
        return json({ error: 'channels-status failed' }, 500)
      }
    },
  },

  '/api/kick/chatroom': {
    async GET(req: Request) {
      try {
        const result = await handleKickChatroom(new URL(req.url))
        return json(result)
      } catch (err) {
        log.error('kick/chatroom failed', { err: String(err) })
        return json({ error: String(err) }, 500)
      }
    },
  },

  '/api/search-categories': {
    async GET(req: Request) {
      const auth = await requireClient(req)
      if (auth instanceof Response) return auth
      try {
        const result = await handleSearchCategories(new URL(req.url))
        return json(result)
      } catch (err) {
        log.error('search-categories failed', { err: String(err) })
        return json({ error: String(err) }, 500)
      }
    },
  },

  '/api/stream-status': {
    async GET(req: Request) {
      const auth = await requireClient(req)
      if (auth instanceof Response) return auth
      try {
        const status = await handleStreamStatus(new URL(req.url))
        return json(status)
      } catch (err) {
        log.error('stream-status failed', { err: String(err) })
        return json({ error: String(err) }, 500)
      }
    },
  },

  '/api/twitch/badges': {
    async GET(req: Request) {
      try {
        const result = await handleTwitchBadges(new URL(req.url))
        return json(result)
      } catch (err) {
        log.error('twitch/badges failed', { err: String(err) })
        return json({ error: String(err) }, 500)
      }
    },
  },
  '/api/twitch/send-message': {
    async POST(req: Request) {
      const auth = await requireClient(req)
      if (auth instanceof Response) return auth
      try {
        // A Twitch HTTP 200 may still contain is_sent=false. Preserve it for
        // the desktop so it can display the provider's exact rejection.
        return json(await handleTwitchSendMessage(req))
      } catch (err) {
        log.error('twitch/send-message failed', { err: String(err) })
        return json({ error: String(err) }, 500)
      }
    },
  },
  '/api/twitch/user': {
    async GET(req: Request) {
      try {
        const url = new URL(req.url)
        const userId = url.searchParams.get('userId')
        if (!userId) {
          return json({ error: 'userId is required' }, 400)
        }

        const user = await fetchTwitchUserById(userId)
        return json({ user })
      } catch (err) {
        log.error('twitch/user failed', { err: String(err) })
        return json({ error: String(err) }, 500)
      }
    },
  },
  '/api/update-stream': {
    async POST(req: Request) {
      const auth = await requireClient(req)
      if (auth instanceof Response) return auth
      try {
        const result = await handleUpdateStream(req)
        return json(result)
      } catch (err) {
        log.error('update-stream failed', { err: String(err) })
        return json({ error: String(err) }, 500)
      }
    },
  },
} as const
