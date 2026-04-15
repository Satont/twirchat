# Known Issues / Gotchas

- Electrobun stores data at ~/.local/share/TwirChat/ on Linux; Tauri uses ~/.local/share/twirchat/
- YouTube adapter intentionally stubbed (Phase 2 deferred)
- Twitch uses twitch-irc crate (not @twurple/chat which is Node-only)
- Kick uses tokio-tungstenite for Pusher-style WS
- Overlay static files cannot be embedded (OBS constraint)
- PKCE callback server must bind to ephemeral port (:0)
- NO unwrap() in production code — use ? and thiserror

## 2026-04-15
- Missing `publicDir` in the desktop Vite configs causes font CSS to be served from the view root instead of `packages/desktop/public`.
- Tauri permission errors for `event.listen` require a capability manifest that includes `core:default` plus opener access for the main window.
- The earlier Rust OAuth port diverged from Electrobun by requiring desktop-side `*_CLIENT_ID` / `*_CLIENT_SECRET`; this breaks auth in normal desktop `.env` setups and must stay backend-proxied.
- `rand::random::<[u8; N]>()` was not viable here because of mixed `rand` versions in the dependency graph; filling fixed byte arrays with `thread_rng().fill_bytes()` avoids that mismatch cleanly.
