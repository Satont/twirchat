import { useGpuixRequired, type PublicInstance } from '@gpuix/react'
import type { PlatformStatusInfo, WatchedChannel } from '@twirchat/shared/types'
import { useRef, useState } from 'react'

import { sanitizeDisplayText } from '../../views/shared/utils/display-text'
import { useT } from '../i18n'
import { watchedStatusesStore } from '../state/app'
import { useStoreSelector } from '../state/create-store'
import { useOverlayClose } from '../state/overlays'
import { useTheme } from '../theme-context'
import { Icon, PlatformIcon } from './ui/Icon'
import { Text } from './ui/Text'

export function ChatFeedHeader({
  channels,
  onEdit,
}: {
  channels: readonly WatchedChannel[]
  onEdit?: () => void
}) {
  const theme = useTheme()
  const { t } = useT()
  return (
    <div
      testId="chat-feed-header"
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: 700, color: theme.text, flexShrink: 0 }}>
        {t('chat.feed.title')}
      </Text>
      <div
        testId="chat-feed-manage"
        role={onEdit ? 'button' : undefined}
        aria-label={t('chat.feed.editSources')}
        tabIndex={onEdit ? 0 : undefined}
        onClick={onEdit}
        onKeyDown={(event) => {
          if (onEdit && (event.key === 'enter' || event.key === 'space')) {
            event.preventDefault()
            event.stopPropagation()
            onEdit()
          }
        }}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
          maxWidth: '100%',
          paddingLeft: 7,
          paddingRight: 7,
          height: 25,
          borderRadius: 5,
          borderWidth: 1,
          borderColor: theme.hairline,
          backgroundColor: theme.fill,
          cursor: onEdit ? 'pointer' : 'default',
          hover: onEdit ? { backgroundColor: theme.fillHover } : undefined,
          focusVisible: { outlineWidth: 1, outlineColor: theme.link },
        }}
      >
        {channels.slice(0, 2).map((channel) => (
          <div
            key={channel.id}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              minWidth: 0,
            }}
          >
            <PlatformIcon platform={channel.platform} size={12} />
            <Text
              style={{
                fontSize: 11,
                color: theme.text2,
                maxWidth: 100,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {sanitizeDisplayText(channel.displayName)}
            </Text>
          </div>
        ))}
        {channels.length > 2 ? (
          <Text style={{ fontSize: 11, color: theme.text2, flexShrink: 0 }}>
            {t('chat.feed.moreSources', { count: channels.length - 2 })}
          </Text>
        ) : null}
        {onEdit ? <Icon name="settings" size={12} color={theme.text2} /> : null}
      </div>
    </div>
  )
}

function channelStatusColor(
  status: PlatformStatusInfo['status'] | undefined,
  theme: ReturnType<typeof useTheme>,
): string {
  if (status === 'connected') return theme.successText
  if (status === 'connecting') return theme.warningText
  if (status === 'error') return theme.dangerText
  return theme.text2
}

export function ChatFeedTargetPicker({
  channels,
  selected,
  onPick,
  focusEditor,
  disabled,
}: {
  channels: readonly WatchedChannel[]
  selected: WatchedChannel
  onPick: (id: string) => void
  focusEditor: () => void
  disabled: boolean
}) {
  const theme = useTheme()
  const { t } = useT()
  const renderer = useGpuixRequired()
  const [open, setOpen] = useState(false)
  const trigger = useRef<PublicInstance | null>(null)
  const options = useRef(new Map<string, number>())
  const dismissedAt = useRef(0)
  const statuses = useStoreSelector(watchedStatusesStore, (entries) => (open ? entries : undefined))
  const selectedStatus = useStoreSelector(watchedStatusesStore, (entries) =>
    entries.get(selected.id),
  )
  const closeWithFocus = () => {
    setOpen(false)
    if (trigger.current) renderer.focusElement?.(trigger.current.id)
  }
  useOverlayClose(open, closeWithFocus)
  const toggle = () => {
    if (!disabled && Date.now() - dismissedAt.current >= 250) setOpen((value) => !value)
  }
  const pick = (id: string) => {
    if (disabled) return
    setOpen(false)
    onPick(id)
    focusEditor()
  }
  const sourceName = sanitizeDisplayText(selected.displayName)
  const triggerLabel = t('chat.feed.sendToChannel', { channel: sourceName })
  return (
    <div style={{ position: 'relative', display: 'flex', flexShrink: 0, minWidth: 0 }}>
      <div
        ref={trigger}
        role="button"
        tabIndex={0}
        testId="chat-feed-send-target"
        aria-label={triggerLabel}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'enter' || event.key === 'space' || event.key === 'down') {
            event.preventDefault()
            event.stopPropagation()
            toggle()
          }
        }}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          minWidth: 0,
          height: 28,
          gap: 4,
          paddingLeft: 4,
          paddingRight: 4,
          borderRadius: 4,
          cursor: disabled ? 'default' : 'pointer',
          backgroundColor: open ? theme.fillHover : undefined,
          hover: disabled ? undefined : { backgroundColor: theme.fillHover },
          focusVisible: { outlineWidth: 1, outlineColor: theme.link },
        }}
      >
        <PlatformIcon platform={selected.platform} size={13} />
        <Text
          style={{
            maxWidth: 104,
            fontSize: 11,
            fontWeight: 600,
            color: theme.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {triggerLabel}
        </Text>
        {selectedStatus?.status !== 'connected' ? (
          <div
            style={{
              width: 5,
              height: 5,
              borderRadius: 3,
              flexShrink: 0,
              backgroundColor: channelStatusColor(selectedStatus?.status, theme),
            }}
          />
        ) : null}
        <Icon name="chevronDown" size={12} color={theme.text2} />
      </div>
      {open ? (
        <anchored deferred side="top" align="start" gap={6}>
          <div
            role="menu"
            aria-label={t('chat.feed.sendTo')}
            onMouseDownOutside={() => {
              dismissedAt.current = Date.now()
              setOpen(false)
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: 212,
              maxHeight: 196,
              overflowY: 'scroll',
              scrollbarColor: theme.scrollbar,
              scrollbarWidth: 4,
              padding: 4,
              backgroundColor: theme.popover,
              borderWidth: 1,
              borderColor: theme.dialogBorder,
              borderRadius: 7,
              boxShadow: {
                offsetX: 0,
                offsetY: 5,
                blurRadius: 18,
                spreadRadius: 0,
                color: '#00000060',
              },
            }}
          >
            {channels.map((channel, index) => {
              const active = channel.id === selected.id
              const status = statuses?.get(channel.id)?.status
              return (
                <div
                  ref={(element: PublicInstance | null) => {
                    if (element) options.current.set(channel.id, element.id)
                    else options.current.delete(channel.id)
                  }}
                  key={channel.id}
                  role="menuitemradio"
                  aria-checked={active}
                  tabIndex={0}
                  autoFocus={active}
                  testId={`chat-feed-target-${channel.id}`}
                  onClick={() => pick(channel.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'escape') closeWithFocus()
                    else if (event.key === 'enter' || event.key === 'space') pick(channel.id)
                    else if (event.key === 'up' || event.key === 'down') {
                      const step = event.key === 'up' ? -1 : 1
                      const next = channels[(index + step + channels.length) % channels.length]
                      const id = next && options.current.get(next.id)
                      if (id !== undefined) renderer.focusElement?.(id)
                    } else return
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    padding: 7,
                    borderRadius: 4,
                    cursor: 'pointer',
                    backgroundColor: active ? theme.fill : undefined,
                    hover: { backgroundColor: theme.fillHover },
                    focusVisible: { outlineWidth: 1, outlineColor: theme.link },
                  }}
                >
                  <PlatformIcon platform={channel.platform} size={14} />
                  <Text
                    style={{
                      flexGrow: 1,
                      minWidth: 0,
                      fontSize: 12,
                      color: theme.text,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {sanitizeDisplayText(channel.displayName)}
                  </Text>
                  <div
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 3,
                      flexShrink: 0,
                      backgroundColor: channelStatusColor(status, theme),
                    }}
                  />
                  {active ? <Icon name="check" size={13} color={theme.link} /> : null}
                </div>
              )
            })}
          </div>
        </anchored>
      ) : null}
    </div>
  )
}
