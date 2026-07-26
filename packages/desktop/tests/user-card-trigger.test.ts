import { expect, test } from 'bun:test'

const [chatMessageSource, chatListSource, userCardSource] = await Promise.all([
  Bun.file(new URL('../src/views/main/components/ChatMessage.vue', import.meta.url)).text(),
  Bun.file(new URL('../src/views/main/components/ChatList.vue', import.meta.url)).text(),
  Bun.file(new URL('../src/views/main/components/UserCardDialog.vue', import.meta.url)).text(),
])

test('opens the user card with a primary click on the author', () => {
  expect(chatMessageSource).toContain('@click.stop="onOpenUserCard"')
  expect(chatMessageSource).not.toContain('@contextmenu')
})

test('carries message context into the card and exposes safe user moderation actions', () => {
  expect(chatMessageSource).toContain('messageId: props.message.id')
  expect(chatListSource).toContain('@open-user-card="onOpenUserCard"')
  expect(chatListSource).toContain(':message-id="selectedUserCardTarget.messageId"')
  expect(userCardSource).toContain('getModerationCapabilities')
  expect(userCardSource).toContain('Timeout 10m')
  expect(userCardSource).toContain('desktopApi.request.moderateMessage')
})

test('chat rows do not mount a dialog component per message', () => {
  expect(chatMessageSource).not.toContain('UserCardDialog')
  expect(chatMessageSource).not.toContain('UserContextMenu')
})
