import {
  DismissableLayer,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useGpuixRequired,
  type Props,
} from '@gpuix/react'
import type { Account } from '@twirchat/shared/types'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

import { useBackend } from '../backend/context'
import { useDragCancellation, useDragMotion } from '../hooks/use-drag-motion'
import { useT } from '../i18n'
import { nativeWindow } from '../native-window'
import { accountsStore, savedAccountsStore, showNotice, watchedChannelsStore } from '../state/app'
import type { ChatTabView } from '../state/chat-tabs'
import {
  chatTabsStore,
  duplicateChatTab,
  renameChatTab,
  reorderChatTab,
  setChatTabColor,
  setChatTabLocked,
} from '../state/chat-tabs'
import { useStore, useStoreSelector } from '../state/create-store'
import { layoutStore } from '../state/layout'
import { useOverlayClose } from '../state/overlays'
import { tabSenderAccounts } from '../state/pane-accounts'
import { tabUnreadStore, type TabUnread } from '../state/tab-unread'
import {
  formatTabUnread,
  formatTabViewers,
  TAB_UNREAD_WIDTH,
  TAB_VIEWER_MIN_WIDTH,
  TAB_MENTION_WIDTH,
} from '../tab-counts'
import { platformColor } from '../theme'
import { useTheme } from '../theme-context'
import { AccountAvatar } from './ChatAccountControl'
import { ActionButton, FormError, FormField, FormInput } from './ui/Form'
import { Icon, PlatformIcon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { Text } from './ui/Text'

export interface WatchedLiveStatus {
  isLive: boolean
  viewerCount?: number
}
interface TabMenuItemOptions {
  disabled?: boolean
  autoFocus?: boolean
}

interface ChannelTabsProps {
  watchedChannels: Array<Omit<ChatTabView, 'sourceChannelId'> & { sourceChannelId?: string }>
  activeTabId: string
  watchedLiveStatuses: Map<string, WatchedLiveStatus>
  homeViewerCount?: number
  tabChannelNames?: Map<string, string[]>
  unread?: ReadonlyMap<string, TabUnread>
  onSelectTab: (id: string) => void
  onAddChannel: () => void
  onRemoveChannel: (id: string) => void
}

export function ChannelTabBar({ leading, tabs }: { leading?: ReactNode; tabs?: ChannelTabsProps }) {
  const barElement = useRef<number | null>(null)

  return (
    <div
      ref={(element) => {
        barElement.current = element?.id ?? null
      }}
      testId="channel-tab-bar"
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        alignContent: 'start',
        minWidth: 0,
        gap: 2,
        paddingTop: 6,
        paddingLeft: 8,
        paddingRight: 8,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {leading}
      {tabs ? <ChannelTabs {...tabs} barElement={barElement} /> : null}
    </div>
  )
}

function ChannelTabs({
  barElement,
  watchedChannels,
  activeTabId,
  watchedLiveStatuses,
  homeViewerCount,
  tabChannelNames,
  unread: suppliedUnread,
  onSelectTab,
  onAddChannel,
  onRemoveChannel,
}: ChannelTabsProps & { barElement: RefObject<number | null> }) {
  const theme = useTheme()
  const { t } = useT()
  const backend = useBackend()
  const renderer = useGpuixRequired()
  const native = nativeWindow(renderer)
  const state = useStore(chatTabsStore)
  const unread = useStoreSelector(tabUnreadStore, (current) => suppliedUnread ?? current)
  const layouts = useStore(layoutStore)
  const chats = useStore(watchedChannelsStore)
  const savedAccounts = useStore(savedAccountsStore)
  const activeAccounts = useStore(accountsStore)
  // Tab → accounts other than the platform defaults its panes send with.
  const tabSenders = useMemo(() => {
    const result = new Map<string, Account[]>()
    for (const [tabId, entry] of layouts) {
      const senders = tabSenderAccounts(entry.layout, chats, savedAccounts, activeAccounts)
      if (senders.length) result.set(tabId, senders)
    }
    return result
  }, [layouts, chats, savedAccounts, activeAccounts])
  const elements = useRef(new Map<string, number>())
  const drag = useRef<{
    id: string
    x: number
    y: number
    moved: boolean
    target: string | null
  } | null>(null)
  const suppressClick = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [dropId, setDropId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  useOverlayClose(menuId !== null, () => setMenuId(null))
  const [edit, setEdit] = useState<{ id: string; title: string; color: string } | null>(null)
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)
  const motion = useDragMotion(({ x, y }) => {
    const current = drag.current
    if (!current || (!current.moved && Math.hypot(x - current.x, y - current.y) < 5)) return
    current.moved = true
    suppressClick.current = true
    const bar =
      barElement.current === null ? null : native.getPaintedElementBounds(barElement.current)
    let targetId: string | null = null
    if (bar && x >= bar.x && x < bar.x + bar.width && y >= bar.y && y < bar.y + bar.height) {
      for (const channel of watchedChannels) {
        const elementId = elements.current.get(channel.id)
        const box = elementId === undefined ? null : native.getPaintedElementBounds(elementId)
        if (box && x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) {
          targetId = channel.id
          break
        }
      }
    }
    current.target = targetId
    setDropId((previous) => (previous === targetId ? previous : targetId))
  })
  const cancelDrag = useCallback(() => {
    motion.cancel()
    if (!drag.current) return
    drag.current = null
    suppressClick.current = true
    setDragging(false)
    setDropId(null)
  }, [motion])
  useDragCancellation(dragging, 'tab-drag', cancelDrag)
  useEffect(() => {
    const current = drag.current
    if (
      current &&
      (!watchedChannels.some((channel) => channel.id === current.id) ||
        state.value.metadata[current.id]?.locked)
    )
      cancelDrag()
  }, [cancelDrag, state.value.metadata, watchedChannels])
  const action = (operation: () => Promise<unknown>) => {
    setMenuId(null)
    void operation().catch((error) =>
      showNotice('error', error instanceof Error ? error.message : String(error)),
    )
  }
  const toolbar = (testId: string, label: string, click: () => void) => (
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
      <Icon name="plus" size={14} color={theme.text2} />
      {label ? <Text style={{ fontSize: 11, color: theme.text2 }}>{label}</Text> : null}
    </div>
  )
  return (
    <>
      <Tab
        testId="tab-home"
        label={t('app.tabs.home')}
        icon={
          <Icon name="home" size={13} color={activeTabId === 'home' ? theme.text : theme.text2} />
        }
        active={activeTabId === 'home'}
        activeColor={theme.text}
        viewers={homeViewerCount}
        unread={unread.get('home')}
        onClick={() => onSelectTab('home')}
      />
      {watchedChannels.map((channel, index) => {
        const sourceId = 'sourceChannelId' in channel ? String(channel.sourceChannelId) : channel.id
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
            aria-description={disabled ? t('common.unavailable') : undefined}
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
        const interaction: Pick<Props, 'onKeyDown' | 'onMouseDown' | 'onMouseMove' | 'onMouseUp'> =
          {
            onKeyDown: (event) => {
              if (event.key === 'escape') {
                cancelDrag()
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
                cancelDrag()
                setMenuId(channel.id)
                return
              }
              if (event.button !== 0) return
              cancelDrag()
              suppressClick.current = false
              if (!locked) {
                drag.current = {
                  id: channel.id,
                  x: event.x ?? 0,
                  y: event.y ?? 0,
                  moved: false,
                  target: null,
                }
                setDragging(true)
              }
            },
            onMouseMove: (event) => {
              const current = drag.current
              if (!current) return
              if (event.pressedButton !== 0) {
                cancelDrag()
                return
              }
              motion.schedule({ x: event.x ?? current.x, y: event.y ?? current.y })
            },
            onMouseUp: (event) => {
              if (event.button !== 0 || !drag.current) return
              motion.schedule({ x: event.x ?? drag.current.x, y: event.y ?? drag.current.y })
              motion.flush()
              const current = drag.current
              drag.current = null
              setDragging(false)
              setDropId(null)
              const sourceIndex = watchedChannels.findIndex((tab) => tab.id === current.id)
              const targetIndex = watchedChannels.findIndex((tab) => tab.id === current.target)
              if (
                current.moved &&
                sourceIndex >= 0 &&
                targetIndex >= 0 &&
                targetIndex !== sourceIndex
              )
                action(() => reorderChatTab(backend, current.id, targetIndex))
            },
          }
        // Browser-style middle-click closes the tab without selecting it.
        // GPUIX does not always populate `button` for aux clicks, so an
        // auxiliary click that is not a right click is the middle button.
        const onAuxClick: Props['onAuxClick'] = (event) => {
          if (event.isRightClick || (event.button !== undefined && event.button !== 1) || locked)
            return
          cancelDrag()
          setMenuId(null)
          onRemoveChannel(channel.id)
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
              flexShrink: 0,
              minWidth: 0,
              maxWidth: '100%',
            }}
          >
            {dropId === channel.id ? (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 2,
                  backgroundColor: theme.accent.primary,
                  pointerEvents: 'none',
                }}
              />
            ) : null}
            <Tab
              testId={`tab-${channel.id}`}
              interaction={interaction}
              onAuxClick={onAuxClick}
              label={label}
              active={active}
              activeColor={color}
              viewers={live?.isLive ? live.viewerCount : undefined}
              unread={unread.get(channel.id)}
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
                  <div
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 3,
                      flexShrink: 0,
                      backgroundColor: live?.isLive ? color : 'transparent',
                    }}
                  />
                  {locked ? <Icon name="lock" size={10} color={theme.text2} /> : null}
                  {tabSenders.get(channel.id)?.length ? (
                    <div
                      testId={`tab-accounts-${channel.id}`}
                      style={{ display: 'flex', flexDirection: 'row', flexShrink: 0 }}
                    >
                      {tabSenders
                        .get(channel.id)
                        ?.slice(0, 3)
                        .map((account, position) => (
                          <div key={account.id} style={{ marginLeft: position ? -4 : 0 }}>
                            <AccountAvatar account={account} size={12} ring={theme.bg} />
                          </div>
                        ))}
                    </div>
                  ) : null}
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
                      t('app.tab.menu.rename'),
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
                    {menuItem(t('app.tab.menu.duplicate'), () =>
                      action(() => duplicateChatTab(backend, channel.id)),
                    )}
                    {menuItem(locked ? t('app.tab.menu.unlock') : t('app.tab.menu.lock'), () =>
                      action(() => setChatTabLocked(backend, channel.id, !locked)),
                    )}
                    {menuItem(
                      t('app.tab.menu.moveLeft'),
                      () => action(() => reorderChatTab(backend, channel.id, index - 1)),
                      { disabled: locked || index === 0 },
                    )}
                    {menuItem(
                      t('app.tab.menu.moveRight'),
                      () => action(() => reorderChatTab(backend, channel.id, index + 1)),
                      { disabled: locked || index === watchedChannels.length - 1 },
                    )}
                    {menuItem(
                      t('app.tab.menu.close'),
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
      <div>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>{toolbar('tab-add', '', onAddChannel)}</TooltipTrigger>
          <TooltipContent side="right" style={{ padding: 6, borderRadius: 6 }}>
            <Text style={{ fontSize: 12, color: theme.text }}>{t('app.addChannel.title')}</Text>
          </TooltipContent>
        </Tooltip>
      </div>
      {state.error ? (
        <Text
          onClick={() => {
            if (state.error) showNotice('error', state.error, 8000)
          }}
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
      {edit ? (
        <Modal
          width={420}
          onClose={() => {
            if (!saving) setEdit(null)
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 20 }}>
            <Text style={{ fontSize: 17, fontWeight: 700, color: theme.text }}>
              {t('app.tab.appearance.title')}
            </Text>
            <FormField
              label={t('app.tab.appearance.nameLabel')}
              hint={t('app.tab.appearance.nameHint')}
            >
              <FormInput
                value={edit.title}
                onChange={(title) => setEdit({ ...edit, title })}
                testId="tab-title-input"
              />
            </FormField>
            <FormField
              label={t('app.tab.appearance.colorLabel')}
              hint={t('app.tab.appearance.colorHint')}
            >
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
                {t('common.cancel')}
              </ActionButton>
              <ActionButton
                primary
                disabled={saving}
                onClick={() => {
                  if (edit.color.trim() && !/^#[a-f0-9]{6}$/iu.test(edit.color.trim())) {
                    setEditError(t('app.tab.appearance.invalidColor'))
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
                {t('common.save')}
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
  onAuxClick,
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
  onAuxClick?: Props['onAuxClick']
}) {
  const theme = useTheme()
  const [hovered, setHovered] = useState(false)
  return (
    <div
      testId={testId}
      {...interaction}
      onAuxClick={onAuxClick}
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
        backgroundColor: active ? theme.accent.tint10 : hovered ? theme.fillHover : undefined,
        flexShrink: 0,
        minWidth: 0,
        maxWidth: '100%',
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
          minWidth: 0,
          flexShrink: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Text>
      <TabCounts
        viewers={viewers}
        unread={unread}
        color={active ? activeColor : theme.text2}
        testId={testId}
      />
    </div>
  )
}

function TabCounts({
  viewers,
  unread,
  color,
  testId,
}: {
  viewers?: number
  unread?: TabUnread
  color: string
  testId?: string
}) {
  const theme = useTheme()
  const { tPlural } = useT()
  const label = formatTabUnread(unread)
  const counts: string[] = []
  if (viewers !== undefined)
    counts.push(tPlural('app.tab.counts.viewers', viewers, { count: viewers.toLocaleString() }))
  if (unread && unread.unread > 0)
    counts.push(
      tPlural('app.tab.counts.unread', unread.unread, {
        count: unread.unread.toLocaleString(),
      }),
    )
  if (unread && unread.mentions > 0)
    counts.push(
      tPlural('app.tab.counts.mentions', unread.mentions, {
        count: unread.mentions.toLocaleString(),
      }),
    )
  const description = counts.join(' · ')
  if (viewers === undefined && !label) return null
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <div
          testId={`${testId}-counts`}
          aria-label={description || undefined}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            flexShrink: 0,
            height: 17,
          }}
        >
          {viewers !== undefined ? (
            <Text
              testId={`${testId}-viewers`}
              style={{
                fontFamily: 'Arial',
                fontSize: 10.5,
                minWidth: TAB_VIEWER_MIN_WIDTH,
                flexShrink: 0,
                textAlign: 'left',
                whiteSpace: 'nowrap',
                color,
              }}
            >
              {formatTabViewers(viewers)}
            </Text>
          ) : null}
          {label ? (
            <div
              testId={`${testId}-unread`}
              style={{
                width: unread && unread.mentions > 0 ? TAB_MENTION_WIDTH : TAB_UNREAD_WIDTH,
                height: 17,
                flexShrink: 0,
                paddingLeft: 2,
                paddingRight: 2,
                borderRadius: 9,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor:
                  unread && unread.mentions > 0 ? theme.accent.tint20 : theme.fillHover,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Arial',
                  fontSize: 10,
                  fontWeight: 600,
                  textAlign: 'right',
                  color:
                    unread && unread.mentions > 0
                      ? (unread.color?.slice(0, 7) ?? theme.link)
                      : theme.text2,
                }}
              >
                {label}
              </Text>
            </div>
          ) : null}
        </div>
      </TooltipTrigger>
      {description ? (
        <TooltipContent
          testId={`${testId}-counts-tooltip`}
          side="bottom"
          sideOffset={6}
          style={{
            backgroundColor: theme.popover,
            borderWidth: 1,
            borderColor: theme.dialogBorder,
            borderRadius: 6,
            padding: 8,
            maxWidth: 280,
          }}
        >
          <Text style={{ fontSize: 11, color: theme.text }}>{description}</Text>
        </TooltipContent>
      ) : null}
    </Tooltip>
  )
}
