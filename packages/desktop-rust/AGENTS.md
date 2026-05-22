# Contributor Guide: TwirChat Desktop (Rust + GPUI)

This package is a native GPUI desktop shell for TwirChat. It is designed to replace the existing Electrobun/Vue implementation incrementally while maintaining strict parity with established protocols, storage schemas, and user behaviors.

## Package Architecture

Every module has a specific role in maintaining the boundary between the UI, the system, and the external world.

### Where Code Belongs

- **ui/**: The visual layer. Holds views, shell layout, shared components, and theme definitions. All GPUI element composition (`div()`, `img()`, etc.) stays here.
- **runtime/**: System and platform boundaries. Opening URLs in browsers, configuration loading, window lifecycle, and updater state. Intentionally GPUI-agnostic.
- **services/**: Business logic and event orchestration. Handles background tasks like message aggregation and platform event routing.
- **storage/**: SQLite persistence. Must preserve schema parity with the TypeScript desktop package to allow seamless user migrations.
- **protocol/**: Shared contracts. Holds Rust ports of the TypeScript protocol definitions. Do not deviate from these types; they are the source of truth for backend communication.
- **platforms/**: Platform-specific adapters (Twitch, YouTube, Kick). Normalizes external API responses into internal TwirChat types.
- **auth/**: OAuth implementation. PKCE flows, token storage, and refresh logic.
- **overlay/**: Internal server logic for OBS overlays. Manages serving local assets and pushing real-time events to the browser-based overlay.
- **parity.rs**: The verification layer. Contains logic to ensure the Rust shell correctly recognizes the asset contract (`dist/`, `views/`) required by the packaging pipeline.

## GPUI Working Rules

GPUI is a single-ownership, reactive framework. Stability depends on following these core patterns.

### Documentation & Reference Workflow

- **Primary Documentation**: Use **Context7 MCP** to query up-to-date GPUI documentation, API details, and usage examples.
- **Visual Reference**: Use **Context7 MCP** and/or **WebFetch** to inspect `https://longbridge.github.io/gpui-component/`.
- **Constraint**: Treat external component sites as an API reference for patterns. Do not copy snippets wholesale; adapt them to the local theme and architecture of this codebase.
- **Expert Knowledge**: Use available Rust-domain skills when relevant to solve low-level implementation problems.

### State & Reactivity

- **Entities**: State must live in an `Entity<T>`. Access via `cx.read()` or `cx.update()`.
- **Notification**: Always call `cx.notify()` after state changes in an `update` block.
- **Weak References**: Use `WeakEntity<T>` for any callback or async block that might outlive the entity to prevent circular references and leaks.

### Inputs & Images

- **Text Inputs**: Never use static elements for inputs. Real fields require `EntityInputHandler`, `ElementInputHandler`, `FocusHandle`, and `track_focus`. You must implement key bindings for navigation (arrows), deletion (backspace/delete), and selection (shift+arrows, cmd/ctrl+a) within the key context.
- **Image Primitives**: Use `gpui::{img, ImageSource, ObjectFit}` for all visual assets. Remote URLs require `ImageSource::from(url)`. Use `.object_fit(ObjectFit::Cover)` for user avatars and `.object_fit(ObjectFit::Contain)` for platform icons and badges.
- **Fault Tolerance**: Always provide `.with_loading(...)` and `.with_fallback(...)`.
- **Optimization**: Mount an image cache at the app root with `retain_all(...)` for views with many repeating assets.

## Good Patterns

- **Separation of Concerns**: Keep the app boot path (`main.rs`) thin. View state belongs in UI entities, but business logic belongs in services or runtime modules.
- **Protocol Integrity**: Preserve strict schema/protocol parity. If the backend or TS package changes a field, update the `protocol/` module to match.
- **UI Organization**: Maintain clear separation between global shell, reusable components, and the theme definition within the `ui/` directory.
- **Focused Testing**: Put tests near the affected boundary. New storage logic should have a storage test; new platform normalization needs a platform test.

## Anti-patterns

- **Boundary Leaks**: Moving storage, network, or complex business logic into GPUI `render` or `update` paths.
- **Type Invention**: Creating local protocol types that drift from the central `protocol/` definitions.
- **Silent Failures**: Hiding errors in detached background tasks. Log every error or surface it to the user.
- **Bypassing Parity**: Making changes that break the packaging/asset verification logic in `parity.rs` or `docs/updater-stabilization.md`.
- **Code Bloat**: Bloating `main.rs` with product-specific logic; use services instead.
- **Blind Copying**: Copying `gpui-component` or LLM-generated snippets without adapting them to the local `Context<T>` or theme patterns.

## Validation & Verification

Always run these commands from the package root before committing.

- **Check**: `cargo check` for fast feedback.
- **Format**: `cargo fmt` to maintain style.
- **Test**: `cargo test` for unit and integration logic.
- **Strict Lint**: `cargo clippy --all-targets --all-features -- -D warnings`.
- **Parity Verification**: If you touch asset paths or packaging logic, run:
  `cargo test packaging_artifact_contains_required_assets -- --nocapture`

The `tests/` directory is broad and boundary-oriented. Ensure new features are covered by a matching test in the relevant domain (storage, protocol, runtime, etc.).
