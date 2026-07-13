import { expect, test } from 'bun:test'

const source = await Bun.file(
  new URL('../src/views/main/components/ChatMessage.vue', import.meta.url),
).text()

test('both chat themes keep initials visible until the cached avatar image loads', () => {
  expect(source).toContain('useAvatarCache')
  expect(source).toContain('avatarImageReady')
  expect(source).toContain('ensureAvatar(props.message)')
  expect(source).toContain('class="avatar-wrap compact-avatar-wrap"')
  expect(source).toContain('class="avatar avatar-fallback"')
  expect(source).toContain('@load="onAvatarLoad"')
  expect(source).toContain('props.showAvatar !== false')
})
