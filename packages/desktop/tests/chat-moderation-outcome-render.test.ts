import { expect, test } from 'bun:test'

const [appSource, chatListSource, chatMessageSource] = await Promise.all([
  Bun.file(new URL('../src/views/main/App.vue', import.meta.url)).text(),
  Bun.file(new URL('../src/views/main/components/ChatList.vue', import.meta.url)).text(),
  Bun.file(new URL('../src/views/main/components/ChatMessage.vue', import.meta.url)).text(),
])

test('applies local and native moderation outcomes to both chat themes', () => {
  expect(appSource).toContain("useRpcListener('chat_moderation'")
  expect(chatListSource).toContain('applyModerationOutcome')
  expect(chatMessageSource).toContain('moderationOutcome')
  expect(chatMessageSource).toContain('moderation-outcome')
  expect(chatMessageSource).toContain('moderationOutcome.label')
  expect(chatMessageSource).toContain('!props.moderationOutcome')
})
