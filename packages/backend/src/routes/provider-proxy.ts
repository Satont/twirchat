import {
  createProviderRelay,
  ProviderRelayError,
  providerRelay,
  readRelayBody,
} from '../api/provider-relay'
import { json, requireClient } from './utils'

type Relay = ReturnType<typeof createProviderRelay>
type Authorize = (request: Request) => Promise<{ clientSecret: string } | Response>

function failure(error: unknown): Response {
  return error instanceof ProviderRelayError
    ? json({ error: error.message }, error.status)
    : json({ error: 'Provider request failed.' }, 502)
}

export function createProviderProxyRoutes(
  service: Relay = providerRelay,
  authorize: Authorize = requireClient,
) {
  const metadata = async (request: Request): Promise<Response> => {
    const client = await authorize(request)
    if (client instanceof Response) return client
    try {
      const source = new URL(request.url).searchParams.get('url') ?? ''
      let body: unknown
      if (request.method === 'POST') {
        const bytes = await readRelayBody(request, 8192)
        try {
          body = JSON.parse(bytes.toString('utf8'))
        } catch {
          throw new ProviderRelayError('Provider request must be valid JSON.')
        }
      }
      return await service.metadata(source, body)
    } catch (error) {
      return failure(error)
    }
  }
  return {
    '/proxy/provider-image': {
      async GET(request: Request): Promise<Response> {
        try {
          return await service.image(new URL(request.url).searchParams.get('url') ?? '')
        } catch (error) {
          return failure(error)
        }
      },
    },
    '/api/provider-metadata': { GET: metadata, POST: metadata },
  }
}

export const providerProxyRoutes = createProviderProxyRoutes()
