# Platform Title Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized native title bar with a compact custom title bar on Windows and macOS, while retaining the existing native Linux window chrome.

**Architecture:** Keep window-policy decisions in the Go application host so the platform-native frame changes before the webview loads. Add a focused Vue title-bar component driven by a small, pure platform-resolution utility: native Wails runtime detection determines production behaviour, while a development-only query parameter renders a Windows or macOS preview in a Linux browser. The existing application becomes a vertical shell only when a compact bar is present.

**Tech Stack:** Go 1.26, Wails v3 alpha2.117, Vue 3.5, TypeScript, Bun test, Vue TSC, Oxc.

## Global Constraints

- Linux keeps the unmodified native title bar and must not render an additional in-app title bar.
- Windows uses `Frameless: true` with `DisableFramelessWindowDecorations: false` so Snap, shadow, DPI scaling, and native resizing remain available.
- macOS uses Wails frameless full-size content while retaining macOS traffic-light controls; no faux macOS controls are rendered.
- Windows title-bar controls use `@wailsio/runtime` `Window` APIs; all interactive descendants of a drag region opt out via `--wails-draggable: no-drag`.
- In browser/Vite development only, `?windowChrome=windows` and `?windowChrome=macos` preview the layout without modifying native Linux chrome.
- No Bun or Node APIs enter `src/views/`.
- Run `bun run fix`, `bun run lint`, `bun run typecheck`, `bun test tests/`, and `go test ./...` before completion.

---

### Task 1: Make native frame policy explicit and testable

**Files:**

- Modify: `packages/desktop/internal/app/application.go`
- Modify: `packages/desktop/internal/app/application_test.go`

**Interfaces:**

- Produces: `mainWindowOptions(name string, platform string) application.WebviewWindowOptions`
- Consumes: `runtime.GOOS` from `New`.

- [x] **Step 1: Write the failing Go tests**

```go
func TestMainWindowOptionsUsesFramelessWindowsWithSystemDecorations(t *testing.T) {
    options := mainWindowOptions("TwirChat", "windows")
    if !options.Frameless {
        t.Fatal("Frameless = false, want true")
    }
    if options.Windows.DisableFramelessWindowDecorations {
        t.Fatal("DisableFramelessWindowDecorations = true, want false")
    }
}

func TestMainWindowOptionsUsesFramelessMacChrome(t *testing.T) {
    options := mainWindowOptions("TwirChat", "darwin")
    if !options.Frameless || !options.Mac.TitleBar.AppearsTransparent || !options.Mac.TitleBar.FullSizeContent {
        t.Fatalf("macOS options = %+v, want compact chrome", options)
    }
}

func TestMainWindowOptionsKeepsLinuxNativeFrame(t *testing.T) {
    if mainWindowOptions("TwirChat", "linux").Frameless {
        t.Fatal("Frameless = true, want false")
    }
}
```

- [x] **Step 2: Run the Go test to verify it fails**

Run: `go test ./internal/app -run TestMainWindowOptions -count=1`

Expected: FAIL because `mainWindowOptions` does not exist.

- [x] **Step 3: Implement only the window-options factory**

```go
func mainWindowOptions(name, platform string) application.WebviewWindowOptions {
    options := application.WebviewWindowOptions{Name: "main", Title: name, URL: "/", Width: 1200, Height: 800}
    switch platform {
    case "windows":
        options.Frameless = true
    case "darwin":
        options.Frameless = true
        options.Mac = application.MacWindow{TitleBar: application.MacTitleBarHidden}
    }
    return options
}
```

Call it from `New(config)` with `runtime.GOOS` and keep the explicit Windows decorations setting false.

- [x] **Step 4: Run the focused and package tests**

Run: `go test ./internal/app -count=1`

Expected: PASS.

### Task 2: Add a testable platform resolver and browser preview contract

**Files:**

- Create: `packages/desktop/src/views/main/services/window-chrome.ts`
- Create: `packages/desktop/tests/window-chrome.test.ts`

**Interfaces:**

- Produces: `WindowChromePlatform`, `resolveWindowChromePlatform(options)`.
- Consumes: a native runtime platform and optional Vite development URL search string.

- [x] **Step 1: Write failing Bun tests**

```ts
test('uses compact chrome for native Windows and macOS only', () => {
  expect(
    resolveWindowChromePlatform({ nativePlatform: 'windows', isDevelopment: false, search: '' }),
  ).toBe('windows')
  expect(
    resolveWindowChromePlatform({ nativePlatform: 'darwin', isDevelopment: false, search: '' }),
  ).toBe('macos')
  expect(
    resolveWindowChromePlatform({ nativePlatform: 'linux', isDevelopment: false, search: '' }),
  ).toBe('native')
})

test('allows compact chrome previews only in development', () => {
  expect(
    resolveWindowChromePlatform({
      nativePlatform: 'linux',
      isDevelopment: true,
      search: '?windowChrome=windows',
    }),
  ).toBe('windows')
  expect(
    resolveWindowChromePlatform({
      nativePlatform: 'linux',
      isDevelopment: false,
      search: '?windowChrome=windows',
    }),
  ).toBe('native')
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `bun test tests/window-chrome.test.ts`

Expected: FAIL because the resolver module is absent.

- [x] **Step 3: Implement the minimal pure resolver**

Return `windows` for native Windows, `macos` for Darwin, otherwise `native`; honor only the two documented preview values when `isDevelopment` is true.

- [x] **Step 4: Re-run the focused Bun test**

Run: `bun test tests/window-chrome.test.ts`

Expected: PASS.

### Task 3: Render and style the compact title bar

**Files:**

- Create: `packages/desktop/src/views/main/components/AppTitleBar.vue`
- Modify: `packages/desktop/src/views/main/App.vue`
- Create: `packages/desktop/tests/app-titlebar-render.test.ts`

**Interfaces:**

- Consumes: `WindowChromePlatform` and Wails `System`/`Window` runtime APIs.
- Produces: a 32px Vue title bar with browser-safe preview state, Windows controls, macOS traffic-light clearance, a Wails drag region, and no Linux rendering.

- [x] **Step 1: Write the failing structural render test**

```ts
test('renders a draggable platform title bar with safe Windows controls', async () => {
  const source = await Bun.file(
    new URL('../src/views/main/components/AppTitleBar.vue', import.meta.url),
  ).text()
  expect(source).toContain('--wails-draggable: drag')
  expect(source).toContain('--wails-draggable: no-drag')
  expect(source).toContain('Window.Minimise()')
  expect(source).toContain('Window.ToggleMaximise()')
  expect(source).toContain('Window.Close()')
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `bun test tests/app-titlebar-render.test.ts`

Expected: FAIL because `AppTitleBar.vue` is absent.

- [x] **Step 3: Implement the component and application shell**

Use a 32px bar. On Windows render minimise, maximise/restore, and close buttons; reserve 80px at the macOS left edge for native traffic lights. Keep the current navigation/content layout in a flex child below the title bar. Add `--wails-resize: all` only when compact chrome is rendered.

- [x] **Step 4: Re-run focused Vue-source tests**

Run: `bun test tests/window-chrome.test.ts tests/app-titlebar-render.test.ts`

Expected: PASS.

### Task 4: Format, build, and validate on Linux

**Files:**

- Modify only files introduced by Tasks 1–3.

- [x] **Step 1: Apply automated project fixes**

Run: `bun run fix`

- [x] **Step 2: Run all fast verification**

Run: `bun test tests/ && go test ./... && bun run lint && bun run typecheck`

Expected: all commands pass.

- [x] **Step 3: Build the browser UI preview**

Run: `bun run build:main`

Expected: Vite build succeeds. Manual Linux preview URL: `http://localhost:9245/?windowChrome=windows` or `?windowChrome=macos` while `bun run dev:main` is running.

- [x] **Step 4: Self-review**

Check the staged diff against every global constraint, confirm no Linux frame policy changed, inspect Windows control drag exclusions, confirm macOS has no faux controls, and verify preview overrides are development-only.

Self-review result: the platform policy tests prove Linux remains native and Windows/macOS become frameless. The component marks its drag surface and each Windows control correctly, macOS renders no faux controls, and the resolver accepts preview query parameters only with `import.meta.env.DEV`. The workspace test suite, Go suite, type checks, linter (0 errors; 15 pre-existing warnings), Vite build, and whitespace diff check all passed on 2026-07-13.
