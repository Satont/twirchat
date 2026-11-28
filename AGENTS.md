## Commit and pull request titles

- Write commit and pull request titles in English using `type(scope)!: summary`.
  The scope and breaking-change marker (`!`) are optional.
- Use one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
  `build`, `ci`, `chore`, or `revert`.
- If present, the scope consists of lowercase alphanumeric words separated by `.`, `/`, `_`,
  or `-`, for example `desktop/chat`.
- Use exactly one space after the colon and a concise, imperative English summary.
  Do not include leading/trailing whitespace or control characters.
- Mark breaking changes with `!` and explain the change and migration in a
  `BREAKING CHANGE:` footer in the commit body and PR description.
- Do not add AI co-author trailers unless explicitly requested.
- The `PR title` check must pass to merge into `main`. Squash the PR and keep its title
  as the squash commit subject so git-cliff can include it in the changelog.

## Agent skills

- Project-local skills live in `.agents/skills/<name>/SKILL.md`. When a task matches one of
  them, read the skill before starting and apply it together with this file. Rules in this
  file take precedence over a skill if they conflict.
- [typescript-best-practices](.agents/skills/typescript-best-practices/SKILL.md) — any `.ts`
  or `.tsx` change: type discipline, boundary parsing, API shape.
- [react-best-practices](.agents/skills/react-best-practices/SKILL.md) — React components,
  hooks, subscriptions, derived state, and rendering performance. GPUIX is not a browser:
  DOM, storage, SSR, RSC, and Next.js examples from upstream do not apply.
- [vue3-typescript-best-practices](.agents/skills/vue3-typescript-best-practices/SKILL.md) —
  the OBS overlay in `packages/desktop/src/views/overlay`.
- [gpui](.agents/skills/gpui/SKILL.md),
  [rust-best-practices](.agents/skills/rust-best-practices/SKILL.md), and
  [rust-async-patterns](.agents/skills/rust-async-patterns/SKILL.md) — Rust/GPUI work,
  including the native parity track.
- [7tv-events-api](.agents/skills/7tv-events-api/SKILL.md) — 7TV EventAPI v3 WebSocket/SSE
  integration, subscriptions, and payload handling.
- [type discipline](.agents/skills/principle-type-system-discipline/SKILL.md),
  [boundary discipline](.agents/skills/principle-boundary-discipline/SKILL.md), and
  [structural safeguards](.agents/skills/principle-encode-lessons-in-structure/SKILL.md)
  — apply when designing types, wiring validation, or turning a repeated correction into
  structure.
- [open-pr](.agents/skills/open-pr/SKILL.md) — before opening or updating a pull request:
  sync the base remote, rebase, rerun checks, push with lease, then create or update the PR.
- [deslop](.agents/skills/deslop/SKILL.md) — review the final diff for AI-generated slop
  before declaring a change complete.
- [find-skills](.agents/skills/find-skills/SKILL.md) — only when the user asks to discover,
  install, or extend agent skills.
- Skills marked `disable-model-invocation: true` must be opened explicitly; do not rely on
  automatic selection. Keep vendored upstream skill text unchanged and put project policy
  here. Sources and hashes are pinned in `.agents/skills/upstream-lock.json` and
  `skills-lock.json`.

## Agent GUI testing

- Run native GUI tests only through `bun run qa:gui` or `bun run qa:native` from `packages/desktop`.
- The launcher creates a private virtual X11 display inside bwrap, with isolated runtime,
  profile, network and device access. A failed isolation check must abort the test.
- Never launch the app or a native renderer directly for agent testing. `focus: false` and
  `GPUIX_BACKGROUND=1` do not protect the user's Linux desktop.
- Never create test windows on the user's Hyprland workspaces, switch their workspace,
  modify their compositor rules/outputs, or forward their display sockets into tests.
- Keep screenshots and GUI automation inside the isolated launcher. Do not capture the host desktop.
- Example: `bun run qa:gui --timeout 30 -- bun src/gpuix/main.tsx`.

## Current feature scope

- Preserve the existing [plugin runtime](docs/plugins.md). Plugin-system expansion,
  including Lua compatibility, is deferred to [issue #76](https://github.com/Satont/twirchat/issues/76).
- Clipboard image uploads are supported in the composer. A file picker and drag-and-drop
  remain deferred to [issue #77](https://github.com/Satont/twirchat/issues/77).
- Neither feature blocks the current GPUIX migration or Chatterino/Leafyrino/Dankerino
  feature-parity acceptance. Resume them only when the user reopens their scope.
- Avatar/emote rendering and ordinary text-link handling remain in the current scope.

## Desktop performance is an acceptance requirement

- Treat CPU, process RSS, throughput and input responsiveness as correctness requirements.
  Do not declare a desktop change complete while a confirmed performance regression remains
  unexplained. Fix the regression or document a concrete measured tradeoff and call it out.
- Before changing message ingestion, stores/subscriptions, classification/filtering, rendering,
  native layout or caches, preserve a baseline. After the change run the full default matrix:
  `bun run --cwd packages/desktop bench:chat`. Also repeat the target workload at least three
  times with fresh output directories:
  `bun run --cwd packages/desktop bench:chat --scenario c50-r5000-p4 --mode production --duration 30`.
  Target: 50 channels, four panes, 5000 total messages/s, 200 retained messages per channel.
- Reuse completed measurements when a later narrow fix does not affect the measured workload.
  Preserve their exact source provenance and run focused functional/GUI checks for that fix.
  Do not repeat the full load matrix just because an unrelated file or cold event path changed.
- Compare identical modes, timings, workloads, window sizes and retention. Record source/native
  provenance, actual processed rate, CPU, RSS median/peak, JS heap and event-loop lag. Report
  medians and ranges for repeated runs. A repeated regression above 5% in CPU or RSS requires
  investigation before completion; repeat the baseline when host variation makes it inconclusive.
  At this target, preserve at least 99% of the offered rate. The coupled generator is not proof
  of maximum sustainable external throughput.
- Production and development results are separate. Verify the loaded React/JSX/reconciler mode;
  do not present disabling development instrumentation as an algorithmic improvement.
  `start` must explicitly use production; `dev` keeps HMR/debug checks. Keep the latest evidence
  and comparisons in `docs/benchmarks/` (current target report: `2026-11-03-interactions/report.md`).
- Freeze sources and native artifacts for each measured run. Do not run builds, tests, profilers
  or other application instances concurrently with resource measurements. Keep all native GUI
  activity inside the isolated launcher described above.
- Do not improve numbers by dropping messages, shrinking retention, lowering refresh rate,
  disabling existing features, forcing GC, trimming allocators or clearing performance entries.
  Any workload or execution-mode experiment must be labeled separately.
- Hot work must scale with the arriving batch or changed rows. Reuse identity indexes and
  policy results; avoid scanning all retained messages/channels, recreating callbacks/objects,
  or rebuilding completion/filter data when the feature is inactive. Preserve immutable
  snapshots and correct behavior when branching from an older snapshot.
- Bound caches, queues and native bookkeeping by explicit limits or live identities. Remove
  retired entries and dispose subscriptions/timers/gestures on close, unmount and HMR. A bounded
  Map is insufficient if its eviction path repeatedly scans deleted entries.
- Never block an input/drag callback on fresh-layout queries, synchronous native request/reply,
  network, storage or file I/O. Use painted geometry snapshots and transient drag state;
  persist layout only for an accepted drop. Coalesce motion updates and skip unchanged targets.
  Escape, release outside the target, focus loss and cancellation must leave the next gesture usable.
  `project-quality/no-blocking-native-geometry` rejects fresh `getElementBounds` references in
  GPUIX application code; those queries remain available only to automation outside the UI.
- For interaction-only fixes, test actual native keyboard/pointer input at small and normal window
  sizes, including long lists, rapid repeated input, cancelled drags and live chat traffic.
  Verify selected items remain visible, popups stay clipped/in bounds, chat continues updating,
  and no input callback stalls. If the fix touches a hot path listed above, the benchmark gate
  also applies. Preserve useful measured evidence rather than relying on visual smoothness alone.

## TypeScript and React quality

- Apply the project-local [TypeScript skill](.agents/skills/typescript-best-practices/SKILL.md),
  [type discipline](.agents/skills/principle-type-system-discipline/SKILL.md),
  [boundary discipline](.agents/skills/principle-boundary-discipline/SKILL.md), and
  [structural safeguards](.agents/skills/principle-encode-lessons-in-structure/SKILL.md)
  when changing TypeScript. Review the final diff with [deslop](.agents/skills/deslop/SKILL.md).
- Apply the relevant [React rules](.agents/skills/react-best-practices/SKILL.md) to components,
  hooks, subscriptions, derived state, and rendering performance. GPUIX has no DOM, browser
  storage, SSR, RSC, or Next.js; those upstream examples do not apply to the native UI.
- Type assertions are forbidden, including `as const`, double assertions, and angle-bracket
  assertions. This project rule overrides upstream exceptions. Use inference, annotations,
  `satisfies`, discriminated unions, or validated boundary schemas. Import/export aliases are fine.
- Declare interfaces and type aliases at module scope, never inside functions.
- Do not replace assertions with `any`, non-null assertions, unchecked typed JSON assignments,
  or generic predicates that do not prove their result. Validate external data at its boundary;
  trust already validated internal contracts.
- Handle rejected promises explicitly. `void promise` does not handle a rejection.
- Keep hooks unconditional, declare their real dependencies, and derive values during render
  when they do not require synchronization with an external system.
- Pinned skill sources and licenses are recorded in `.agents/skills/upstream-lock.json`.
  Keep vendored upstream skill text unchanged; put project policy here.

## Code Formatting and Linting

This project uses **oxlint** (linter) and **oxfmt** (formatter) from the Oxc toolchain.

### Configuration

- **Linter config**: `.oxlintrc.json`
- **Formatter config**: `.oxfmtrc.json`
- **Format rules**: max 100 chars per line, no semicolons, single quotes, sorted imports

### Scripts

```bash
bun run lint          # Check for lint errors
bun run lint:fix      # Fix auto-fixable lint issues
bun run format        # Format all files
bun run format:check  # Check formatting without modifying
bun run check         # Run typecheck + lint + format check
bun run fix           # Fix lint and format issues
```

### IMPORTANT: Format After Changes

**ALWAYS run `bun run fix` after creating or modifying files.**

Before declaring any task complete:

1. Run `bun run fix` to auto-format and fix lint issues
2. Verify no lint errors remain: `bun run lint`
3. Verify no type errors: `bun run typecheck`

### Editor Integration

**VSCode**: Extension `oxc.oxc-vscode` — auto-format and fix on save enabled
**Zed**: Extension "Oxc" — configured in `.zed/settings.json`
**JetBrains**: Plugin "Oxc" — external tools configured in `.idea/`

---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

---

## Project: TwirChat

- [Architecture map](docs/architecture.md) — package boundaries, runtime topology, state ownership, and constraints.
- [Desktop guide](packages/desktop/AGENTS.md) and [GPUIX notes](packages/desktop/src/gpuix/README.md) — UI/runtime seam, native reentrancy, HMR, and interaction rules.
- [Backend guide](packages/backend/AGENTS.md) and [self-hosting docs](packages/backend/README.md) — hosted HTTP/WebSocket runtime and PostgreSQL.
- [Shared package guide](packages/shared/AGENTS.md) — contracts consumed by desktop and backend.
- [Release guide](docs/releasing.md) — desktop packaging, native build, and backend deployment.

Run workspace scripts from their package or with `bun run --cwd <package> <script>`.
The workspace package manifests define the actual build and test commands. Build the pinned
desktop runtime with `bun run --cwd packages/desktop build:native` before running local tests
that exercise the isolated native launcher.
