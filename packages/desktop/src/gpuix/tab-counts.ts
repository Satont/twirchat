import type { TabUnread } from './state/tab-unread'

export const TAB_VIEWER_WIDTH = 36
export const TAB_UNREAD_WIDTH = 28

const viewerUnits = ['K', 'M', 'B', 'T']
const fullCount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export function formatTabViewers(count: number): string {
  if (count < 1000) return String(count)
  let scale = 1000
  for (const unit of viewerUnits) {
    const compact = Math.round((count / scale) * 10) / 10
    if (compact < 1000) return `${compact.toFixed(1)}${unit}`
    scale *= 1000
  }
  return '999T+'
}

export function formatTabUnread(unread: TabUnread | undefined): string {
  if (!unread || unread.unread <= 0) return ''
  const count = unread.mentions > 0 ? unread.mentions : unread.unread
  return `${unread.mentions > 0 ? '@' : ''}${count > 99 ? '99+' : count}`
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
