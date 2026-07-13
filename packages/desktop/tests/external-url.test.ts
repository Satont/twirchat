import { expect, test } from 'bun:test'

import { openExternalUrl } from '../src/views/main/services/external-url'

test('opens an external URL through the Wails browser runtime', async () => {
  const openedUrls: Array<string | URL> = []
  await openExternalUrl('https://noctalia.dev/', {
    OpenURL: async (url) => {
      openedUrls.push(url)
    },
  })

  expect(openedUrls).toEqual(['https://noctalia.dev/'])
})
