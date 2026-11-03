import { DismissableLayer, useGpuixRequired, type Props } from '@gpuix/react'
import type { PlatformStatusInfo } from '@twirchat/shared/types'
import { useRef, useState, type ReactNode } from 'react'

import { useBackend } from '../backend/context'
import { showNotice } from '../state/app'
import type { ChatTabView } from '../state/chat-tabs'
import {
  chatTabsStore,
  duplicateChatTab,
  renameChatTab,
  reorderChatTab,
  restoreClosedChatTab,
  setChatTabColor,
  setChatTabLocked,
} from '../state/chat-tabs'
import { useStore } from '../state/create-store'
import { useOverlayClose } from '../state/overlays'
import type { TabUnread } from '../state/tab-unread'
import { accent, platformColor } from '../theme'
import { useTheme } from '../theme-context'
import { ActionButton, FormError, FormField, FormInput } from './ui/Form'
import { Icon, PlatformIcon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { Text } from './ui/Text'

export interface WatchedLiveStatus {
  isLive: boolean
  viewerCount?: number
}
function formatViewers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

interface TabMenuItemOptions {
  disabled?: boolean
  autoFocus?: boolean
}

export function ChannelTabBar({
  watchedChannels,
  activeTabId,
  watchedLiveStatuses,
  homeViewerCount,
  tabChannelNames,
  unread,
  onSelectTab,
  onAddChannel,
  onRemoveChannel,
  onSearchAll,
}: {
  watchedChannels: Array<Omit<ChatTabView, 'sourceChannelId'> & { sourceChannelId?: string }>
  activeTabId: string
  watchedStatuses: Map<string, PlatformStatusInfo>
  watchedLiveStatuses: Map<string, WatchedLiveStatus>
  homeViewerCount?: number
  tabChannelNames?: Map<string, string[]>
  unread?: ReadonlyMap<string, TabUnread>
  onSelectTab: (id: string) => void
  onAddChannel: () => void
  onRemoveChannel: (id: string) => void
  onSearchAll?: () => void
}) {
  const theme = useTheme()
  const backend = useBackend()
  const renderer = useGpuixRequired()
  const state = useStore(chatTabsStore)
  const elements = useRef(new Map<string, number>())
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean; target: number } | null>(
    null,
  )
  const suppressClick = useRef(false)
  const [dropId, setDropId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  useOverlayClose(menuId !== null, () => setMenuId(null))
  const [edit, setEdit] = useState<{ id: string; title: string; color: string } | null>(null)
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)
  const action = (operation: () => Promise<unknown>) => {
    setMenuId(null)
    void operation().catch((error) =>
      showNotice('error', error instanceof Error ? error.message : String(error)),
    )
  }
  const toolbar = (
    testId: string,
    label: string,
    icon: 'plus' | 'search' | 'refresh',
    click: () => void,
  ) => (
    <div
      testId={testId}
      tabIndex={0}
      onClick={click}
      onKeyDown={(event) => {
        if (event.key === 'enter' || event.key === 'space') {
          event.preventDefault()
          click()
        }
      }}
      style={{
        padding: 6,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        borderRadius: 4,
        cursor: 'pointer',
        hover: { backgroundColor: theme.fillHover },
      }}
    >
      <Icon name={icon} size={14} color={theme.text2} />
      {label ? <Text style={{ fontSize: 11, color: theme.text2 }}>{label}</Text> : null}
    </div>
  )
  return (
    <>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 2,
          paddingTop: 6,
          paddingLeft: 8,
          paddingRight: 8,
          borderBottomWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.navBg,
          flexShrink: 0,
          overflowX: 'scroll',
          userSelect: 'none',
        }}
      >
        <Tab
          testId="tab-home"
          label="My channels"
          icon={
            <Icon name="home" size={13} color={activeTabId === 'home' ? theme.text : theme.text2} />
          }
          active={activeTabId === 'home'}
          activeColor={theme.text}
          viewers={homeViewerCount}
          unread={unread?.get('home')}
          onClick={() => onSelectTab('home')}
        />
        {watchedChannels.map((channel, index) => {
          const sourceId =
            'sourceChannelId' in channel ? String(channel.sourceChannelId) : channel.id
          const live = watchedLiveStatuses.get(channel.id) ?? watchedLiveStatuses.get(sourceId)
          const metadata = state.value.metadata[channel.id]
          const names = tabChannelNames?.get(channel.id)
          const label = metadata?.title ?? (names?.length ? names.join(', ') : channel.displayName)
          const active = activeTabId === channel.id
          const color =
            metadata?.color ?? (channel.platform ? platformColor(channel.platform) : theme.text2)
          const locked = metadata?.locked === true
          const menuItem = (
            text: string,
            callback: () => void,
            { disabled = false, autoFocus = false }: TabMenuItemOptions = {},
          ) => (
            <div
              role="menuitem"
              aria-description={disabled ? 'Unavailable' : undefined}
              autoFocus={autoFocus}
              tabIndex={disabled ? undefined : 0}
              onClick={() => {
                if (!disabled) callback()
              }}
              onKeyDown={(event) => {
                if (!disabled && (event.key === 'enter' || event.key === 'space')) {
                  event.preventDefault()
                  callback()
                }
              }}
              style={{
                padding: 6,
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.45 : 1,
                borderRadius: 4,
                hover: disabled ? {} : { backgroundColor: theme.fillHover },
              }}
            >
              <Text style={{ fontSize: 12, color: theme.text }}>{text}</Text>
            </div>
          )
          const interaction: Pick<
            Props,
            'onKeyDown' | 'onMouseDown' | 'onMouseMove' | 'onMouseUp'
          > = {
            onKeyDown: (event) => {
              if (event.key === 'escape') {
                drag.current = null
                suppressClick.current = true
                setDropId(null)
                setMenuId(null)
                event.preventDefault()
              }
              if (
                event.modifiers?.ctrl &&
                event.modifiers.shift &&
                (event.key === 'left' || event.key === 'right')
              ) {
                event.preventDefault()
                action(() =>
                  reorderChatTab(backend, channel.id, index + (event.key === 'left' ? -1 : 1)),
                )
              }
              if (event.key === 'menu' || (event.key === 'f10' && event.modifiers?.shift)) {
                event.preventDefault()
                setMenuId(channel.id)
              }
              if (event.key === 'delete' && !locked) {
                event.preventDefault()
                onRemoveChannel(channel.id)
              }
            },
            onMouseDown: (event) => {
              if (event.button === 2) {
                setMenuId(channel.id)
                return
              }
              if (event.button !== 0) return
              suppressClick.current = false
              if (!locked)
                drag.current = {
                  id: channel.id,
                  x: event.x ?? 0,
                  y: event.y ?? 0,
                  moved: false,
                  target: index,
                }
            },
            onMouseMove: (event) => {
              const current = drag.current
              if (!current) return
              const x = event.x ?? 0,
                y = event.y ?? 0
              if (Math.hypot(x - current.x, y - current.y) < 5 && !current.moved) return
              current.moved = true
              suppressClick.current = true
              for (let target = 0; target < watchedChannels.length; target++) {
                const id = watchedChannels[target]!.id
                const elementId = elements.current.get(id)
                const box = elementId === undefined ? null : renderer.getElementBounds?.(elementId)
                if (
                  box &&
                  x >= box.x &&
                  x <= box.x + box.width &&
                  y >= box.y - 12 &&
                  y <= box.y + box.height + 12
                ) {
                  current.target = target
                  setDropId(id)
                  break
                }
              }
            },
            onMouseUp: () => {
              const current = drag.current
              drag.current = null
              setDropId(null)
              if (current?.moved && current.target !== index)
                action(() => reorderChatTab(backend, current.id, current.target))
            },
          }
          return (
            <div
              key={channel.id}
              ref={(element) => {
                if (element) elements.current.set(channel.id, element.id)
                else elements.current.delete(channel.id)
              }}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                borderLeftWidth: dropId === channel.id ? 2 : 0,
                borderColor: accent.primary,
              }}
            >
              <Tab
                testId={`tab-${channel.id}`}
                interaction={interaction}
                label={label}
                active={active}
                activeColor={color}
                viewers={live?.isLive ? live.viewerCount : undefined}
                unread={unread?.get(channel.id)}
                onClick={() => {
                  if (!suppressClick.current) onSelectTab(channel.id)
                }}
                icon={
                  <>
                    {channel.platform ? (
                      <PlatformIcon
                        platform={channel.platform}
                        size={12}
                        color={active ? color : theme.text2}
                      />
                    ) : (
                      <Icon name="chat" size={12} color={active ? color : theme.text2} />
                    )}
                    {live?.isLive ? (
                      <div
                        style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }}
                      />
                    ) : null}
                    {locked ? <Icon name="lock" size={10} color={theme.text2} /> : null}
                  </>
                }
              />
              {menuId === channel.id ? (
                <DismissableLayer
                  onEscapeKeyDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setMenuId(null)
                  }}
                >
                  <anchored
                    deferred
                    side="bottom"
                    align="start"
                    gap={4}
                    occlude
                    style={{ borderRadius: 7 }}
                  >
                    <div
                      role="menu"
                      onMouseDownOutside={() => setMenuId(null)}
                      onKeyDown={(event) => {
                        if (event.key === 'escape') {
                          event.preventDefault()
                          event.stopPropagation()
                          setMenuId(null)
                        }
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        minWidth: 190,
                        padding: 4,
                        backgroundColor: theme.popover,
                        borderWidth: 1,
                        borderColor: theme.border,
                        borderRadius: 7,
                      }}
                    >
                      {menuItem(
                        'Rename / tab color…',
                        () => {
                          setMenuId(null)
                          setEditError('')
                          setEdit({
                            id: channel.id,
                            title: metadata?.title ?? '',
                            color: metadata?.color ?? '',
                          })
                        },
                        { autoFocus: true },
                      )}
                      {menuItem('Duplicate tab', () =>
                        action(() => duplicateChatTab(backend, channel.id)),
                      )}
                      {menuItem(locked ? 'Unlock tab' : 'Lock tab', () =>
                        action(() => setChatTabLocked(backend, channel.id, !locked)),
                      )}
                      {menuItem(
                        'Move left',
                        () => action(() => reorderChatTab(backend, channel.id, index - 1)),
                        { disabled: locked || index === 0 },
                      )}
                      {menuItem(
                        'Move right',
                        () => action(() => reorderChatTab(backend, channel.id, index + 1)),
                        { disabled: locked || index === watchedChannels.length - 1 },
                      )}
                      {menuItem(
                        'Close tab',
                        () => {
                          setMenuId(null)
                          onRemoveChannel(channel.id)
                        },
                        { disabled: locked },
                      )}
                    </div>
                  </anchored>
                </DismissableLayer>
              ) : null}
            </div>
          )
        })}
        {toolbar('tab-add', '', 'plus', onAddChannel)}
        {onSearchAll ? toolbar('tab-search-all', 'Search all', 'search', onSearchAll) : null}
        {state.value.closed.length
          ? toolbar('tab-restore', 'Restore tab', 'refresh', () =>
              action(() => restoreClosedChatTab(backend)),
            )
          : null}
        {state.error ? (
          <Text
            onClick={() => showNotice('error', state.error!, 8000)}
            style={{
              fontSize: 11,
              color: theme.warningText,
              maxWidth: 240,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            {state.error}
          </Text>
        ) : null}
      </div>
      {edit ? (
        <Modal
          width={420}
          onClose={() => {
            if (!saving) setEdit(null)
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 20 }}>
            <Text style={{ fontSize: 17, fontWeight: 700, color: theme.text }}>Tab appearance</Text>
            <FormField label="Tab name" hint="Leave blank to use the assigned channel names.">
              <FormInput
                value={edit.title}
                onChange={(title) => setEdit({ ...edit, title })}
                testId="tab-title-input"
              />
            </FormField>
            <FormField label="Tab color" hint="Use #RRGGBB, or leave blank for the platform color.">
              <FormInput
                value={edit.color}
                onChange={(color) => setEdit({ ...edit, color })}
                testId="tab-color-input"
              />
            </FormField>
            <FormError>{editError}</FormError>
            <div
              style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}
            >
              <ActionButton disabled={saving} onClick={() => setEdit(null)}>
                Cancel
              </ActionButton>
              <ActionButton
                primary
                disabled={saving}
                onClick={() => {
                  if (edit.color.trim() && !/^#[a-f0-9]{6}$/iu.test(edit.color.trim())) {
                    setEditError('Use a color in #RRGGBB format.')
                    return
                  }
                  setSaving(true)
                  void renameChatTab(backend, edit.id, edit.title)
                    .then(() => setChatTabColor(backend, edit.id, edit.color.trim()))
                    .then(() => setEdit(null))
                    .catch((error) => setEditError(String(error)))
                    .finally(() => setSaving(false))
                }}
              >
                Save
              </ActionButton>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}

function Tab({
  label,
  icon,
  active,
  activeColor,
  viewers,
  unread,
  onClick,
  testId,
  interaction,
}: {
  label: string
  icon?: ReactNode
  active: boolean
  activeColor: string
  viewers?: number
  unread?: TabUnread
  onClick: () => void
  testId?: string
  interaction?: Pick<Props, 'onKeyDown' | 'onMouseDown' | 'onMouseMove' | 'onMouseUp'>
}) {
  const theme = useTheme()
  const [hovered, setHovered] = useState(false)
  return (
    <div
      testId={testId}
      {...interaction}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        interaction?.onKeyDown?.(event)
        if (event.key === 'enter' || event.key === 'space') {
          event.preventDefault()
          onClick()
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingTop: 5,
        paddingBottom: 6,
        paddingLeft: 10,
        paddingRight: 8,
        cursor: 'pointer',
        borderTopLeftRadius: 6,
        borderTopRightRadius: 6,
        borderBottomWidth: 2,
        borderColor: active ? activeColor : 'transparent',
        backgroundColor: active ? accent.tint10 : hovered ? theme.fillHover : undefined,
        flexShrink: 0,
        marginBottom: -1,
      }}
    >
      {icon}
      <Text
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: unread?.mentions
            ? (unread.color?.slice(0, 7) ?? theme.link)
            : active
              ? activeColor
              : hovered
                ? theme.text
                : theme.text2,
          maxWidth: 150,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Text>
      {viewers !== undefined ? (
        <Text style={{ fontSize: 10, color: active ? activeColor : theme.text2, opacity: 0.7 }}>
          {formatViewers(viewers)}
        </Text>
      ) : null}
      {unread && unread.unread > 0 ? (
        <div
          testId={`${testId}-unread`}
          style={{
            minWidth: 17,
            height: 17,
            paddingLeft: 4,
            paddingRight: 4,
            borderRadius: 9,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: unread.mentions > 0 ? accent.tint20 : theme.fillHover,
          }}
        >
          <Text
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: unread.mentions > 0 ? (unread.color?.slice(0, 7) ?? theme.link) : theme.text2,
            }}
          >
            {unread.mentions > 0
              ? `@${unread.mentions > 99 ? '99+' : unread.mentions}`
              : unread.unread > 99
                ? '99+'
                : unread.unread}
          </Text>
        </div>
      ) : null}
    </div>
  )
}
