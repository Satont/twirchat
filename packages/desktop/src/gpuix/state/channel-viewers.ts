/**
 * Combined viewer totals for multi-channel sources ("My channels" and feeds).
 *
 * Each platform reports its own number, and the same channel can be delivered by
 * several platforms at once (a Twitch login watched next to a Kick replay of the
 * same stream), so the sources are de-duplicated by login before they are summed.
 */

export interface ViewerSource {
  readonly platform: string
  readonly channelSlug: string
}

export interface ViewerStatus {
  readonly isLive: boolean
  readonly viewerCount?: number
}

const MULTI_PLATFORM_PLATFORMS: ReadonlySet<string> = new Set(['twitch', 'kick'])

export interface CombinedViewers {
  /** Sum over every live source whose platform reports viewers (twitch, kick). */
  readonly viewers: number
  readonly liveCount: number
}

/** Same channel on several platforms is one broadcaster: the name decides. */
function viewerKey(source: ViewerSource): string {
  return source.channelSlug.trim().toLowerCase()
}

/**
 * Sums viewer counts across the sources that stream now. Returns `null` while
 * nothing streams: an empty total would read as "0 watching" rather than offline.
 */
export function combinedChannelViewers(
  sources: readonly ViewerSource[],
  statuses: ReadonlyMap<string, ViewerStatus>,
): CombinedViewers | null {
  let viewers = 0
  let liveCount = 0
  const counted = new Set<string>()
  for (const source of sources) {
    if (!MULTI_PLATFORM_PLATFORMS.has(source.platform)) continue
    const key = viewerKey(source)
    if (!key || counted.has(key)) continue
    const status = statuses.get(`${source.platform}:${key}`)
    if (!status?.isLive) continue
    counted.add(key)
    liveCount += 1
    viewers += status.viewerCount ?? 0
  }
  return liveCount === 0 ? null : { viewers, liveCount }
}

export type TransportStatusState = 'connecting' | 'connected' | 'disconnected' | 'error'

/** A connected or still-connecting transport counts as on air; a failed one does not. */
export function isLiveTransportStatus(status: TransportStatusState): boolean {
  return status !== 'error' && status !== 'disconnected'
}
