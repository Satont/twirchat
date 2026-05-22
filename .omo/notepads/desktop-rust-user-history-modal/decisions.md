# Decisions: desktop-rust-user-history-modal

## 2026-05-22 Task: planning
- Scope: parity plus polish.
- Required metadata platforms: Twitch and Kick.
- YouTube/unsupported platforms: graceful metadata fallback only.
- Test strategy: TDD with existing Rust tests, UI contract tests, and smoke run.
- No Playwright/browser E2E added in this pass.
