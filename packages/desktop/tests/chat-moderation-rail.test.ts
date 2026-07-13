import { expect, test } from 'bun:test'

const [chatListSource, chatMessageSource] = await Promise.all([
  Bun.file(new URL('../src/views/main/components/ChatList.vue', import.meta.url)).text(),
  Bun.file(new URL('../src/views/main/components/ChatMessage.vue', import.meta.url)).text(),
])

test('renders a moderation rail on My Channels and gates watched tabs by capability', () => {
  expect(chatMessageSource).toContain('MessageModerationRail')
  expect(chatMessageSource).toContain('@moderate="onModerate"')
  expect(chatListSource).toContain('!props.watchedChannel')
  expect(chatListSource).toContain('getModerationCapabilities')
  expect(chatListSource).toContain('@moderate="onModerate"')
  expect(chatListSource).toContain('moderateMessage')
})
