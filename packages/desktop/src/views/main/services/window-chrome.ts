export type WindowChromePlatform = 'native' | 'windows' | 'macos'

interface ResolveWindowChromeOptions {
  nativePlatform: string
  isDevelopment: boolean
  search: string
}

function previewPlatform(search: string): WindowChromePlatform | undefined {
  const preview = new URLSearchParams(search).get('windowChrome')

  if (preview === 'windows' || preview === 'macos') {
    return preview
  }
}

export function resolveWindowChromePlatform({
  nativePlatform,
  isDevelopment,
  search,
}: ResolveWindowChromeOptions): WindowChromePlatform {
  if (isDevelopment) {
    const preview = previewPlatform(search)
    if (preview) {
      return preview
    }
  }

  if (nativePlatform === 'windows') {
    return 'windows'
  }
  if (nativePlatform === 'darwin') {
    return 'macos'
  }

  return 'native'
}
