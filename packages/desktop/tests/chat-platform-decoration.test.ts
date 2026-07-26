import { expect, test } from 'bun:test'

const [chatListSource, moderationRailSource] = await Promise.all([
  Bun.file(new URL('../src/views/main/components/ChatList.vue', import.meta.url)).text(),
  Bun.file(
    new URL('../src/views/main/components/MessageModerationRail.vue', import.meta.url),
  ).text(),
])

test('keeps platform decorations in My channels and hides them in watched channel panes', () => {
  const compact = chatListSource.replace(/\s+/g, '')
  expect(compact).toContain(
    ':show-platform-color-stripe="watchedChannel?false:settings?.showPlatformColorStripe"',
  )
  expect(compact).toContain(':show-platform-icon="watchedChannel?false:settings?.showPlatformIcon"')
})

test('does not render the moderation rail fill until a moderation gesture starts', () => {
  expect(moderationRailSource).toContain('<span v-if="distance > 0" class="moderation-rail-fill"')
})
