import { providerRelay, ProviderRelayError } from '../api/provider-relay'

export async function handleSevenTVImageProxy(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const emoteId = url.pathname.slice('/proxy/7tv/'.length)
  const size = url.searchParams.get('size') ?? '4x'
  const format = url.searchParams.get('format') ?? 'webp'
  if (
    !/^[A-Za-z0-9_-]{1,100}$/.test(emoteId) ||
    !/^[1-4]x$/.test(size) ||
    !['webp', 'avif', 'gif', 'png'].includes(format)
  )
    return new Response('Invalid 7TV image request.', { status: 400 })
  try {
    return await providerRelay.image(
      'https://cdn.7tv.app/emote/' + emoteId + '/' + size + '.' + format,
    )
  } catch (error) {
    return new Response('Failed to fetch 7TV image.', {
      status: error instanceof ProviderRelayError ? error.status : 502,
    })
  }
}
