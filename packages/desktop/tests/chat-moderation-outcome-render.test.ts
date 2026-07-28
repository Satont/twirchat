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
  expect(chatMessageSource).toContain('isTombstone')
  expect(chatMessageSource).toContain(
    '!props.moderationOutcome || props.moderationOutcome.isTombstone',
  )
  expect(chatMessageSource).toContain('v-if="!props.moderationOutcome?.isTombstone"')
})

test('keeps deleted message content visible, struck through, in both chat themes', () => {
  const occurrences = chatMessageSource.split(
    'deleted: props.moderationOutcome?.isTombstone',
  ).length
  expect(occurrences).toBe(3)
  expect(chatMessageSource).toContain('.msg-text.deleted')
  expect(chatMessageSource).toContain('text-decoration: line-through')
})

test('does not render reply text for deleted-message tombstones in either chat theme', () => {
  expect(chatMessageSource).toContain(
    'v-if="message.reply && !props.moderationOutcome?.isTombstone"',
  )
})
