const BROWSER_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])

/**
 * Build the argv that opens `rawUrl` in the default browser.
 *
 * URLs reach this from untrusted chat text. Windows must not go through `cmd`:
 * Bun leaves arguments without spaces unquoted, so `|` or `&` would run as shell
 * operators. `rundll32` hands the URL straight to the protocol handler.
 */
export function browserCommand(
  rawUrl: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const parsed = new URL(rawUrl)
  if (!BROWSER_PROTOCOLS.has(parsed.protocol))
    throw new Error(`Refusing to open ${parsed.protocol} URL.`)
  if (platform === 'darwin') return ['open', parsed.href]
  if (platform === 'win32') return ['rundll32', 'url.dll,FileProtocolHandler', parsed.href]
  return ['xdg-open', parsed.href]
}
