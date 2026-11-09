import type { OAuthDonationProvider } from '@twirchat/shared/donations'
import { z } from 'zod'

import {
  createDonationOAuth,
  donationCodeChallenge,
  donationCodeVerifier,
  donationLoopbackPort,
  donationRefreshToken,
  donationRelayState,
  donationRelayTicket,
  DonationOAuthFailure,
  oauthDonationProvider,
  type DonationOAuthCredentials,
} from '../auth/donations'
import { requireClient } from './utils'

const MAX_REQUEST_BYTES = 16_384
const privateHeaders = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
}

type ProviderRequest = Request & { params: { provider: string } }
type OAuth = ReturnType<typeof createDonationOAuth>
type Client = Parameters<OAuth['start']>[0]

function oauthError(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: privateHeaders })
}

async function readBody<T>(req: Request, schema: z.ZodType<T>): Promise<T | Response> {
  if (!req.body) return oauthError('invalid_request', 400)
  if (Number(req.headers.get('content-length')) > MAX_REQUEST_BYTES)
    return oauthError('invalid_request', 413)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0
  let text = ''
  try {
    for await (const chunk of req.body) {
      size += chunk.byteLength
      if (size > MAX_REQUEST_BYTES) return oauthError('invalid_request', 413)
      text += decoder.decode(chunk, { stream: true })
    }
    const value: unknown = JSON.parse(text + decoder.decode())
    const parsed = schema.safeParse(value)
    return parsed.success ? parsed.data : oauthError('invalid_request', 400)
  } catch {
    return oauthError('invalid_request', 400)
  }
}

export function createDonationOAuthRoutes(
  credentials: Record<OAuthDonationProvider, DonationOAuthCredentials | undefined>,
  oauth = createDonationOAuth(),
  authenticate = requireClient,
) {
  function withClient(run: (req: ProviderRequest, client: Client) => Response | Promise<Response>) {
    return (req: ProviderRequest) => {
      const provider = oauthDonationProvider.safeParse(req.params.provider)
      if (!provider.success) return oauthError('unknown_provider', 404)
      const client = credentials[provider.data]
      if (!client) return oauthError('unconfigured', 503)
      return run(req, { ...client, provider: provider.data })
    }
  }

  function post<T>(schema: z.ZodType<T>, run: (client: Client, body: T) => unknown) {
    return withClient(async (req, client) => {
      const body = await readBody(req, schema)
      if (body instanceof Response) return body
      try {
        const auth = await authenticate(req)
        if (auth instanceof Response) return auth
        return Response.json(await run(client, body), { headers: privateHeaders })
      } catch (error) {
        if (error instanceof DonationOAuthFailure) {
          if (error.code === 'invalid_session') return oauthError(error.code, 400)
          if (error.code === 'refresh_rejected') return oauthError(error.code, 401)
        }
        return oauthError('provider_unavailable', 502)
      }
    })
  }

  return {
    '/api/auth/donations/:provider/start': {
      POST: post(
        z.object({ codeChallenge: donationCodeChallenge, port: donationLoopbackPort }),
        oauth.start,
      ),
    },
    '/auth/donations/:provider/callback': {
      GET: withClient((req, client) => {
        const location = oauth.callback(client, new URL(req.url))
        if (!location) {
          return new Response('This TwirChat sign-in is invalid or expired. Start it again.', {
            status: 400,
            headers: privateHeaders,
          })
        }
        return new Response(null, {
          status: 303,
          headers: { ...privateHeaders, Location: location.href },
        })
      }),
    },
    '/api/auth/donations/:provider/exchange': {
      POST: post(
        z.object({
          codeVerifier: donationCodeVerifier,
          state: donationRelayState,
          ticket: donationRelayTicket,
        }),
        oauth.exchange,
      ),
    },
    '/api/auth/donations/:provider/refresh': {
      POST: post(z.object({ refreshToken: donationRefreshToken }), oauth.refresh),
    },
  }
}
