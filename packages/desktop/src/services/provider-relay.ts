import { providerMetadataTarget, providerImageProxyPath } from '@twirchat/shared/emote-proxy'

import { backendFetch } from '../runtime-config'

export function fetchProviderMetadata(url: string, init?: RequestInit): Promise<Response> {
  if (!providerMetadataTarget(url))
    return Promise.reject(new Error('Unsupported provider endpoint.'))
  return backendFetch('/api/provider-metadata?url=' + encodeURIComponent(url), init)
}

export function fetchProviderImage(url: string, init?: RequestInit): Promise<Response> {
  const path = providerImageProxyPath(url)
  return path ? backendFetch(path, init) : fetch(url, init)
}
