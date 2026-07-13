import { Browser } from '@wailsio/runtime'

export interface BrowserRuntime {
  OpenURL(url: string | URL): Promise<void>
}

export function openExternalUrl(url: string, browser: BrowserRuntime = Browser): Promise<void> {
  return browser.OpenURL(url)
}
