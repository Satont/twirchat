/**
 * Events feed — port of EventsFeed.vue: header with a count pill plus a
 * scrollable list of event cards (type icon, user, label, platform chip,
 * time, avatar). Events come from the shared eventsStore (newest last,
 * capped at 200) instead of a prop.
 */

import type { NormalizedEvent } from '@twirchat/shared/types'

import { useStore } from '../state/create-store'
import { eventsStore } from '../state/app'
import { accent, eventColors, platformColor, withAlpha } from '../theme'
import { useTheme } from '../theme-context'
import { Icon, type IconName } from './ui/Icon'
import { Text } from './ui/Text'
import { RemoteImage } from './ui/RemoteImage'

function eventIconName(type: NormalizedEvent['type']): IconName {
  switch (type) {
    case 'follow':
      return 'heart'
    case 'sub':
    case 'resub':
    case 'membership':
      return 'star'
    case 'gift_sub':
      return 'gift'
    case 'raid':
      return 'zap'
    case 'host':
      return 'playCircle'
    case 'bits':
    case 'superchat':
      return 'dollar'
    default:
      return 'bell'
  }
}

function eventLabel(type: NormalizedEvent['type']): string {
  switch (type) {
    case 'follow':
      return 'Follow'
    case 'sub':
      return 'Subscription'
    case 'resub':
      return 'Re-subscription'
    case 'gift_sub':
      return 'Gift sub'
    case 'raid':
      return 'Raid'
    case 'host':
      return 'Host'
    case 'bits':
      return 'Bits'
    case 'superchat':
      return 'Super Chat'
    case 'membership':
      return 'Membership'
    default:
      return type
  }
}

function eventColor(type: NormalizedEvent['type']): string {
  return eventColors[type] ?? '#8b8b99'
}

function formatTime(ts: Date): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function eventDetail(ev: NormalizedEvent): string {
  const d = ev.data as Record<string, unknown>
  switch (ev.type) {
    case 'resub':
      return d.months ? `${d.months} months` : ''
    case 'raid':
      return d.viewers ? `${d.viewers} viewers` : ''
    case 'bits':
      return d.amount ? `${d.amount} bits` : ''
    case 'gift_sub':
      return d.count ? `×${d.count}` : ''
    case 'superchat':
      return d.amount ? String(d.amount) : ''
    default:
      return ''
  }
}

function EventCard({ event: ev }: { event: NormalizedEvent }) {
  const theme = useTheme()
  const color = eventColor(ev.type)
  const pColor = platformColor(ev.platform)
  const detail = eventDetail(ev)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 10,
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 14,
        paddingRight: 14,
        hover: { backgroundColor: theme.surface2 },
      }}
    >
      {/* Event type icon */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          backgroundColor: withAlpha(color, 0.13),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon name={eventIconName(ev.type)} size={16} color={color} />
      </div>

      {/* Event info */}
      <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
            flexWrap: 'wrap',
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
            {ev.user.displayName}
          </Text>
          <Text style={{ fontSize: 12, fontWeight: 600, color }}>{eventLabel(ev.type)}</Text>
          {detail ? <Text style={{ fontSize: 12, color: theme.text2 }}>{detail}</Text> : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              borderWidth: 1,
              borderColor: withAlpha(pColor, 0.27),
              backgroundColor: withAlpha(pColor, 0.09),
              borderRadius: 4,
              paddingTop: 1,
              paddingBottom: 1,
              paddingLeft: 5,
              paddingRight: 5,
            }}
          >
            <Text style={{ fontSize: 10, fontWeight: 600, color: pColor }}>
              {ev.platform.toUpperCase()}
            </Text>
          </div>
          <Text style={{ fontSize: 11, color: theme.text2 }}>{formatTime(ev.timestamp)}</Text>
        </div>
      </div>

      {/* Avatar */}
      {ev.user.avatarUrl ? (
        <RemoteImage
          url={ev.user.avatarUrl}
          objectFit="cover"
          style={{ width: 36, height: 36, borderRadius: 18, flexShrink: 0 }}
        />
      ) : (
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: '#2a2a33',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: 700, color: theme.text2 }}>
            {ev.user.displayName[0]}
          </Text>
        </div>
      )}
    </div>
  )
}

export function EventsFeed() {
  const theme = useTheme()
  const events = useStore(eventsStore)

  return (
    <div
      style={{
        flexGrow: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingTop: 12,
          paddingBottom: 12,
          paddingLeft: 20,
          paddingRight: 20,
          borderBottomWidth: 1,
          borderColor: theme.border,
          flexShrink: 0,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: 700, color: theme.text2 }}>
          {'Events'.toUpperCase()}
        </Text>
        {events.length > 0 ? (
          <div
            style={{
              backgroundColor: accent.tint15,
              borderRadius: 10,
              paddingTop: 1,
              paddingBottom: 1,
              paddingLeft: 7,
              paddingRight: 7,
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: 700, color: accent.primary }}>
              {String(events.length)}
            </Text>
          </div>
        ) : null}
      </div>

      {/* List */}
      <div
        style={{
          flexGrow: 1,
          minHeight: 0,
          overflowY: 'scroll',
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 12,
          paddingRight: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {events.length === 0 ? (
          <div
            style={{
              flexGrow: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              paddingTop: 60,
              paddingBottom: 60,
              paddingLeft: 32,
              paddingRight: 32,
            }}
          >
            <div style={{ opacity: 0.35, marginBottom: 4, display: 'flex' }}>
              <Icon name="bell" size={48} color={theme.text2} />
            </div>
            <Text style={{ fontSize: 15, fontWeight: 600, color: theme.text, textAlign: 'center' }}>
              No events yet
            </Text>
            <Text
              style={{
                fontSize: 13,
                color: theme.text2,
                maxWidth: 280,
                lineHeight: 1.5,
                textAlign: 'center',
              }}
            >
              Follows, subs, raids and bits will appear here.
            </Text>
          </div>
        ) : (
          events.map((ev) => <EventCard key={ev.id} event={ev} />)
        )}
      </div>
    </div>
  )
}
