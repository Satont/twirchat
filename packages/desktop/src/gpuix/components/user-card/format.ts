/**
 * Pure formatting helpers for the user card dialog.
 *
 * `hexMix` replaces the CSS `color-mix()` the Vue header gradient used;
 * everything else is a line-for-line port of the date math and metadata
 * text builders from UserCardDialog.vue.
 */

import type { UserCardMetadataResponse } from '@twirchat/shared/protocol'

/** Channel-wise sRGB mix: `pctA` (0..1) of `a` blended with the rest of `b`. */
export function hexMix(a: string, b: string, pctA: number): string {
  const parse = (hex: string): [number, number, number] => {
    let value = hex.replace('#', '')
    if (value.length === 3) {
      value = value
        .split('')
        .map((char) => char + char)
        .join('')
    }
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ]
  }
  const [ar, ag, ab] = parse(a)
  const [br, bg, bb] = parse(b)
  const channel = (x: number, y: number): string =>
    Math.round(x * pctA + y * (1 - pctA))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`
}

export function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

// ── Date math (ported from UserCardDialog.vue) ──────────────────────────────

export function formatAbsoluteDate(value: string | null | undefined): string | null {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toLocaleDateString()
}

function addCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date)
  const day = result.getDate()

  result.setDate(1)
  result.setMonth(result.getMonth() + months)

  const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()
  result.setDate(Math.min(day, lastDayOfTargetMonth))

  return result
}

function formatDurationPart(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`
}

export function formatElapsedDuration(value: string | null | undefined): string | null {
  if (!value) return null

  const start = new Date(value)
  if (Number.isNaN(start.getTime())) {
    return null
  }

  const end = new Date()
  if (start > end) {
    return '0 seconds'
  }

  const totalMonths = Math.max(
    0,
    (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth(),
  )

  let monthsSinceStart = totalMonths
  while (monthsSinceStart > 0 && addCalendarMonths(start, monthsSinceStart) > end) {
    monthsSinceStart -= 1
  }

  const years = Math.floor(monthsSinceStart / 12)
  const months = monthsSinceStart % 12
  const afterMonths = addCalendarMonths(start, monthsSinceStart)

  let remainingMilliseconds = Math.max(0, end.getTime() - afterMonths.getTime())

  const dayInMs = 24 * 60 * 60 * 1000
  const hourInMs = 60 * 60 * 1000
  const minuteInMs = 60 * 1000
  const secondInMs = 1000

  const days = Math.floor(remainingMilliseconds / dayInMs)
  remainingMilliseconds -= days * dayInMs

  const hours = Math.floor(remainingMilliseconds / hourInMs)
  remainingMilliseconds -= hours * hourInMs

  const minutes = Math.floor(remainingMilliseconds / minuteInMs)
  remainingMilliseconds -= minutes * minuteInMs

  const seconds = Math.floor(remainingMilliseconds / secondInMs)

  const parts = [
    years > 0 ? formatDurationPart(years, 'year') : null,
    months > 0 ? formatDurationPart(months, 'month') : null,
    days > 0 ? formatDurationPart(days, 'day') : null,
    hours > 0 ? formatDurationPart(hours, 'hour') : null,
    minutes > 0 ? formatDurationPart(minutes, 'minute') : null,
    seconds > 0 ? formatDurationPart(seconds, 'second') : null,
  ].filter((part): part is string => part !== null)

  return parts.join(' ') || '0 seconds'
}

// ── Metadata card texts (ported from UserCardDialog.vue) ────────────────────

export function accountAgeText(metadata: UserCardMetadataResponse | null): string | null {
  const field = metadata?.accountAge
  if (!field) return null

  if (field.status === 'available') {
    return `Created ${formatAbsoluteDate(field.createdAt) ?? field.createdAt}`
  }

  return field.message ?? 'Unavailable'
}

export function followAgeText(metadata: UserCardMetadataResponse | null): string | null {
  const field = metadata?.followAge
  if (!field) return null

  if (field.status === 'available') {
    const absoluteDate = formatAbsoluteDate(field.followedAt) ?? field.followedAt
    const elapsedDuration = formatElapsedDuration(field.followedAt)

    return elapsedDuration
      ? `Following since ${absoluteDate} · ${elapsedDuration}`
      : `Following since ${absoluteDate}`
  }

  return field.message ?? 'Unavailable'
}

export function subscriptionDurationText(metadata: UserCardMetadataResponse | null): string | null {
  const field = metadata?.subscriptionDuration
  if (!field) return null

  if (field.status === 'available') {
    if (field.currentlySubscribed === true) {
      const parts = ['Currently subscribed']

      if (field.tier) {
        parts.push(`Tier ${field.tier}`)
      }

      if (field.isGift) {
        parts.push(field.gifterDisplayName ? `Gifted by ${field.gifterDisplayName}` : 'Gifted sub')
      }

      if (field.message) {
        parts.push(field.message)
      }

      return parts.join(' · ')
    }

    return field.message ?? 'Not currently subscribed'
  }

  return field.message ?? 'Unavailable'
}

export function subAgeText(metadata: UserCardMetadataResponse | null): string | null {
  const field = metadata?.subAge
  if (!field) return null

  if (field.status === 'available' && field.months !== null) {
    return `${field.months} month${field.months === 1 ? '' : 's'}`
  }

  return field.message ?? 'Unavailable'
}
