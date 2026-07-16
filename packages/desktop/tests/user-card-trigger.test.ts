import { expect, test } from 'bun:test'

const [chatMessageSource, contextMenuSource, userCardSource] = await Promise.all([
  Bun.file(new URL('../src/views/main/components/ChatMessage.vue', import.meta.url)).text(),
  Bun.file(new URL('../src/views/main/components/UserContextMenu.vue', import.meta.url)).text(),
  Bun.file(new URL('../src/views/main/components/UserCardDialog.vue', import.meta.url)).text(),
])

test('opens the user card with a primary click', () => {
  expect(contextMenuSource).toContain('@click="openDialog"')
  expect(contextMenuSource).not.toContain('@contextmenu')
})

test('carries message context into the card and exposes safe user moderation actions', () => {
  expect(chatMessageSource).toContain(':message-id="message.id"')
  expect(contextMenuSource).toContain(':message-id="messageId"')
  expect(userCardSource).toContain('getModerationCapabilities')
  expect(userCardSource).toContain('Timeout 10m')
  expect(userCardSource).toContain('desktopApi.request.moderateMessage')
})
