import type { TabUnread } from './state/tab-unread'

export const TAB_VIEWER_MIN_WIDTH = 20

const viewerUnits = ['K', 'M', 'B', 'T']
const fullCount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export function formatTabViewers(count: number): string {
  if (count < 1000) return String(count)
  let scale = 1000
  for (const unit of viewerUnits) {
    const value = count / scale
    const compact = value < 100 ? Math.round(value * 10) / 10 : Math.round(value)
    if (compact < 1000) return `${compact.toFixed(compact < 100 ? 1 : 0)}${unit}`
    scale *= 1000
  }
  return '999T+'
}

export function describeTabCounts(
  viewers: number | undefined,
  unread: TabUnread | undefined,
): string {
  const counts: string[] = []
  if (viewers !== undefined) counts.push(`${fullCount.format(viewers)} viewers`)
  if (unread && unread.unread > 0) counts.push(`${fullCount.format(unread.unread)} unread messages`)
  if (unread && unread.mentions > 0) counts.push(`${fullCount.format(unread.mentions)} mentions`)
  return counts.join(' · ')
}
