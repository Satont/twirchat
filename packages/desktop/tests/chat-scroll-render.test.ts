import { expect, test } from 'bun:test'

const [chatListSource, chatMessageSource] = await Promise.all([
  Bun.file(new URL('../src/views/main/components/ChatList.vue', import.meta.url)).text(),
  Bun.file(new URL('../src/views/main/components/ChatMessage.vue', import.meta.url)).text(),
])

test('re-aligns a followed virtual list after Vue and Virtua measure appended rows', () => {
  expect(chatListSource).toContain('isChatNearBottom')
  expect(chatListSource).toContain('requestAnimationFrame')
  expect(chatListSource).toContain("{ flush: 'post' }")
})

test('re-aligns only a followed chat when an emote image changes a row height', () => {
  expect(chatMessageSource).toContain("emit('content-load')")
  expect(chatListSource).toContain('@content-load="followLatestAfterLayout"')
})
