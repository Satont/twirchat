import { expect, test } from 'bun:test'

test('renders a draggable platform title bar with safe Windows controls', async () => {
  const source = await Bun.file(
    new URL('../src/views/main/components/AppTitleBar.vue', import.meta.url),
  ).text()

  expect(source).toContain('--wails-draggable: drag')
  expect(source).toContain('--wails-draggable: no-drag')
  expect(source).toContain('Window.Minimise()')
  expect(source).toContain('Window.ToggleMaximise()')
  expect(source).toContain('Window.Close()')
  expect(source).toContain("props.platform === 'windows'")
  expect(source).toContain("props.platform === 'macos'")
})

test('keeps the Linux app layout native and exposes development previews', async () => {
  const source = await Bun.file(new URL('../src/views/main/App.vue', import.meta.url)).text()

  expect(source).toContain('resolveWindowChromePlatform')
  expect(source).toContain('System.IsWindows()')
  expect(source).toContain('System.IsMac()')
  expect(source).toContain("windowChromePlatform.value !== 'native'")
})

test('updates compact chrome after the Wails runtime publishes its platform', async () => {
  const source = await Bun.file(new URL('../src/views/main/App.vue', import.meta.url)).text()

  expect(source).toContain("'wails:runtime-config-ready'")
  expect(source).toContain('window.addEventListener')
  expect(source).toContain('window.removeEventListener')
})
