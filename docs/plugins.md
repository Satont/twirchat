# TwirChat plugins

In **Settings → Plugins**, enter a local `manifest.json` path or an HTTPS link to the manifest
and select **Install plugin**. TwirChat saves the package in the active profile and leaves it
disabled until you select **Enable**. Use **Disable** to unload it or **Remove** to delete the
installed copy.

Enable code from sources you trust. Each plugin runs in its own Bun process with the permissions of your user account. It can access local files and the network. Through the TwirChat API it can read chat events and send messages through connected accounts.

## StreamX

Keep the [`plugins/streamx`](../plugins/streamx) directory together and install its
[`manifest.json`](../plugins/streamx/manifest.json). To update an older copy, remove it in
**Settings → Plugins** and install the new manifest. Enable **StreamX**, then open **Add
channel**, select **StreamX**, and enter the channel name, for example `le-xot`.

In the StreamX pane, choose **Move to My channels** to put its messages in the same timeline
as your connected accounts. The choice is saved. Use the close button on the StreamX source
chip in the **My channels** header to remove it from the combined feed.

Live messages from StreamX sources in **My channels** also appear in the OBS chat overlay.
To show only StreamX, add `platforms=plugin:streamx:chat` to the overlay URL. Update StreamX
to version 0.2.1 or later to keep the recent history loaded on connection out of the overlay.

The plugin loads up to 50 recent messages and receives new ones without a StreamX account.
Chat is read-only and shows nickname colors. StreamX 0.2.2 and a compatible TwirChat release
display emote images in chat history, live chat and the OBS overlay. It uses the same internal GraphQL
endpoint as [LeChat](https://github.com/le-xot/lechat/blob/f68e4311d7595603aac603b530b18763fffb66c0/src/providers/streamx.rs).

## A TypeScript plugin

Create a directory with this `manifest.json`.

```json
{
  "id": "local-echo",
  "name": "Local Echo",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.ts"
}
```

Copy the [v1 API types](../packages/desktop/src/plugins/api.ts) into that directory as `plugin-api.ts`. Add this `index.ts`.

```ts
import type { PluginDefinition } from './plugin-api'

const activate: PluginDefinition = (api) => {
  api.registerCommand('local-echo', async ({ channel, args }) => {
    if (!channel) throw new Error('Open one chat before using /local-echo.')
    await api.addSystemMessage(channel, args.join(' ') || 'Hello from Local Echo')
  })
}

export default activate
```

Enable the plugin, open a chat and enter `/local-echo hello`. The command inserts a local system message. The manifest API version must match the host API version. Check `api.appVersion` during activation if the plugin needs a specific TwirChat release.

The manifest ID uses lowercase letters, digits and hyphens and starts with a letter. Entrypoints are relative JavaScript or TypeScript files. Package local imports alongside the entrypoint and bundle external dependencies ahead of time. Installation copies up to 16 MiB and 512 entries and skips hidden files and `node_modules`.

## Commands and events

Register commands and subscriptions during activation. Commands receive the full text, whitespace-delimited arguments and the current channel when the composer has a single target. Existing composer commands and user aliases take precedence in built-in chats. Only one enabled plugin can own a given command name.

| API                               | Behavior                                                         |
| --------------------------------- | ---------------------------------------------------------------- |
| `on('message', handler)`          | Incoming messages from built-in chats and plugin transports      |
| `on('channelStatus', handler)`    | Connection status changes for a channel                          |
| `on('chatEvent', handler)`        | Platform events such as follows and subscriptions                |
| `on('roomState', handler)`        | Room-mode updates when the platform supplies them                |
| `on('moderation', handler)`       | Message deletions, timeouts and bans                             |
| `on('chatCleared', handler)`      | Platform chat-clear events                                       |
| `getChannels()`                   | Configured account channels and saved watched channels           |
| `sendMessage(channel, text)`      | Send through the channel's connected account or plugin transport |
| `addSystemMessage(channel, text)` | Insert local text without sending to the platform                |

Pass channel objects returned by the host back to the API so watched-channel identity is preserved. Message timestamps are Unix milliseconds. Local messages created with `addSystemMessage` stay out of the plugin event stream.

Use Bun and JavaScript APIs for network requests, WebSockets, JSON and timers. Return a cleanup function from activation to close resources. TwirChat gives cleanup a short grace period, then stops the plugin process. Event delivery uses bounded batches and Settings reports overflow if a subscriber falls behind. Keep callbacks short and handle rejected promises. An uncaught plugin failure appears in Settings, where you can retry the plugin.

## Channel transports

Register a transport during activation to make it available in **Add channel**.

```ts
api.registerTransport('example', {
  name: 'Example Chat',
  connect(channelId, { signal, emitMessage, setStatus }) {
    const socket = new WebSocket(`wss://chat.example.com/${encodeURIComponent(channelId)}`)
    socket.addEventListener('open', () => setStatus({ status: 'connected' }))
    socket.addEventListener('close', () => setStatus({ status: 'disconnected' }))
    socket.addEventListener('error', () =>
      setStatus({ status: 'error', error: 'Connection failed' }),
    )
    socket.addEventListener('message', ({ data }) => {
      if (typeof data === 'string' && data.length > 0) {
        emitMessage({
          id: crypto.randomUUID(),
          author: { id: 'remote', name: 'Remote' },
          text: data,
        })
      }
    })
    signal.addEventListener('abort', () => socket.close(), { once: true })
    return () => socket.close()
  },
})
```

Set `author.color` to a `#RRGGBB` color to style the nickname. Without a `sendMessage` handler
the transport is read-only. Add that handler and keep its connection state keyed by the channel
identifier to send messages. Channel identifiers preserve case. TwirChat saves channels in
tabs, splits and the combined **My channels** feed, and shares the connection across these views.
For sources in **My channels**, set `historical: true` on any backfilled message to keep it
out of the live OBS overlay.
To display emote images, keep their names in `text` and pass `emotes` with each emote's `id`,
`name`, HTTPS `imageUrl`, inclusive UTF-16 `positions` and optional `aspectRatio` (width divided
by height). Each position is `{ start, end }` in the original message text. A message can carry
up to 64 positions.
Messages in the combined feed can be read there. To send through a writable plugin transport,
open its channel in a tab or split.

The v1 contract includes the APIs above and a chat pane for third-party transports. Lua compatibility and fork-specific APIs for custom UI, rich message mutation and completion providers are outside this contract.

## Remote installation and updates

Paste the direct HTTPS URL of a hosted manifest into **Settings → Plugins**. For public GitHub
repositories, both a file page link and its raw link work, including branch names with slashes.

```text
https://github.com/OWNER/REPO/blob/main/plugin/manifest.json
https://raw.githubusercontent.com/OWNER/REPO/refs/heads/main/plugin/manifest.json
```

TwirChat checks saved remote sources after startup and every six hours. **Check for update**
checks one plugin immediately. TwirChat installs only newer versions with the same plugin ID
and a compatible API version. It keeps the enabled state, and an enabled plugin reloads after
an update. If downloading or starting the replacement fails, TwirChat keeps the previous version.

Publish a self-contained entrypoint or list its additional runtime files in the optional
`files` array. Paths are relative to the manifest directory. TwirChat downloads the entrypoint
automatically, so it does not need to appear in `files`. Bundle third-party dependencies into
the package before publishing.

```json
{
  "id": "local-echo",
  "name": "Local Echo",
  "version": "1.0.1",
  "apiVersion": 1,
  "entry": "index.ts",
  "files": ["commands/echo.ts", "assets/icon.png"]
}
```

For GitHub, each downloaded version comes from a single commit. A branch link tracks future
releases and a commit link stays pinned. On other HTTPS hosts, publish a consistent set of
files with each version. Using version-specific filenames helps keep the manifest and its
files in sync while a new version is being published.
