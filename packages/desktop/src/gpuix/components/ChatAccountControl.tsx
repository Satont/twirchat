import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react'
import type { Account, PanelNode, WatchedChannel } from '@twirchat/shared/types'
import { useRef, useState } from 'react'

import { useBackend } from '../backend/context'
import { resolveChatAccount } from '../chat-account'
import { runUiTask } from '../hooks/run-ui-task'
import { useT } from '../i18n'
import { accountsStore, savedAccountsStore, showNotice, watchedChannelsStore } from '../state/app'
import { useStore } from '../state/create-store'
import { setPanelAccount } from '../state/layout'
import { useOverlayClose } from '../state/overlays'
import { panelAccountId, panelsShowingChat } from '../state/pane-accounts'
import { platformColor, withAlpha } from '../theme'
import { useTheme } from '../theme-context'
import { Icon, PlatformIcon } from './ui/Icon'
import { RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'

const platformName = (platform: WatchedChannel['platform']) =>
  platform === 'youtube' ? 'YouTube' : platform === 'twitch' ? 'Twitch' : 'Kick'

interface AccountAvatarProps {
  account: Account
  size: number
  ring?: string
}

export function AccountAvatar({ account, size, ring }: AccountAvatarProps) {
  const theme = useTheme()
  const frame = {
    width: size,
    height: size,
    borderRadius: size / 2,
    ...(ring ? { borderWidth: 1.5, borderColor: ring } : {}),
  }
  const initial = (account.displayName || account.username).slice(0, 1).toUpperCase()
  const letter = (
    <div
      style={{
        ...frame,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.accent.primary,
      }}
    >
      <Text style={{ fontSize: Math.max(7, size * 0.55), fontWeight: 800, color: theme.bg }}>
        {initial}
      </Text>
    </div>
  )
  // RemoteImage only falls back after a failed load; without a URL it would draw nothing.
  if (!account.avatarUrl) return letter
  return (
    <RemoteImage
      url={account.avatarUrl}
      thumbnailSize={size}
      objectFit="cover"
      style={frame}
      fallback={letter}
    />
  )
}

interface AccountChoiceOptions {
  channel: WatchedChannel
  /** The account the pane sends with, if any. */
  account: Account | undefined
  /** The layout pane the choice belongs to; without it the choice applies to the whole chat. */
  pane?: { tabId: string; panel: PanelNode }
  onChosen: () => void
}

/**
 * Picking an account for a chat shown in a single pane keeps it on the chat, as before panes had
 * their own accounts. While the chat is open in other panes too, only this pane changes.
 */
function useAccountChoice({ channel, account, pane, onChosen }: AccountChoiceOptions) {
  const backend = useBackend()
  const saved = useStore(savedAccountsStore)
  const active = useStore(accountsStore)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // The mousedown that dismisses the menu ends in a click on the trigger; ignore that click.
  const dismissedAt = useRef(0)
  useOverlayClose(open, () => setOpen(false))
  const choices = saved.filter((candidate) => candidate.platform === channel.platform)
  const fallback = active.find((candidate) => candidate.platform === channel.platform)

  async function apply(next: Account): Promise<void> {
    const shared =
      pane &&
      panelsShowingChat(channel.id).some(
        (entry) => entry.tabId !== pane.tabId || entry.panel.id !== pane.panel.id,
      )
    if (pane && shared) {
      const chatChoice = resolveChatAccount(channel, saved, active)
      const accountId = next.id === chatChoice?.id ? null : next.id
      await setPanelAccount(backend, pane.tabId, pane.panel.id, accountId)
      return
    }
    // Picking the default account follows later default changes instead of pinning it.
    const accountId = next.id === fallback?.id ? null : next.id
    if (accountId !== (channel.accountId ?? null)) {
      const updated = await backend.api.setWatchedChannelAccount({ id: channel.id, accountId })
      watchedChannelsStore.modify((channels) =>
        channels.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      )
    }
    if (pane && panelAccountId(pane.panel))
      await setPanelAccount(backend, pane.tabId, pane.panel.id, null)
  }

  async function choose(next: Account): Promise<void> {
    setOpen(false)
    if (next.id === account?.id) return onChosen()
    setBusy(true)
    try {
      await apply(next)
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : String(error), 5000)
    } finally {
      setBusy(false)
      onChosen()
    }
  }

  const toggle = () => {
    if (busy || Date.now() - dismissedAt.current < 250) return
    setOpen((value) => !value)
  }
  const dismiss = () => {
    dismissedAt.current = Date.now()
    setOpen(false)
  }
  return { open, busy, toggle, dismiss, choose, choices, fallback }
}

interface AccountMenuProps {
  channel: WatchedChannel
  account: Account | undefined
  side: 'top' | 'bottom'
  choice: ReturnType<typeof useAccountChoice>
  /** Distinguishes panes that show the same chat. */
  testKey: string
}

function AccountMenu({ channel, account, side, choice, testKey }: AccountMenuProps) {
  const theme = useTheme()
  const { t } = useT()
  const color = platformColor(channel.platform)
  return (
    <anchored deferred side={side} align={side === 'top' ? 'start' : 'end'} gap={6}>
      <div
        role="menu"
        testId={`chat-account-${testKey}-menu`}
        onMouseDownOutside={choice.dismiss}
        style={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 220,
          maxWidth: 300,
          padding: 4,
          backgroundColor: theme.popover,
          borderWidth: 1,
          borderColor: theme.border,
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
        <Text
          style={{
            fontSize: 11,
            color: theme.text2,
            paddingTop: 4,
            paddingBottom: 4,
            paddingLeft: 8,
            paddingRight: 8,
          }}
        >
          {t('chat.account.sendInAs', { channel: channel.displayName })}
        </Text>
        {choice.choices.map((candidate) => {
          const selected = candidate.id === account?.id
          const pick = () => runUiTask(choice.choose(candidate))
          return (
            <div
              key={candidate.id}
              role="menuitemradio"
              aria-checked={selected}
              testId={`chat-account-${testKey}-${candidate.id}`}
              tabIndex={0}
              autoFocus={selected}
              onClick={pick}
              onKeyDown={(event) => {
                if (event.key === 'enter' || event.key === 'space') {
                  event.preventDefault()
                  pick()
                }
              }}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingTop: 5,
                paddingBottom: 5,
                paddingLeft: 8,
                paddingRight: 8,
                borderRadius: 4,
                cursor: 'pointer',
                backgroundColor: selected ? withAlpha(color, 0.14) : 'transparent',
                hover: { backgroundColor: theme.fillHover },
              }}
            >
              <AccountAvatar account={candidate} size={18} />
              <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 12, color: theme.text }}>{`@${candidate.username}`}</Text>
                {candidate.id === choice.fallback?.id ? (
                  <Text style={{ fontSize: 11, color: theme.text2 }}>
                    {t('chat.account.default')}
                  </Text>
                ) : null}
              </div>
              {selected ? <Icon name="check" size={12} color={color} /> : null}
            </div>
          )
        })}
        {choice.choices.length === 0 ? (
          <Text
            style={{
              fontSize: 12,
              color: theme.text2,
              paddingTop: 4,
              paddingBottom: 6,
              paddingLeft: 8,
              paddingRight: 8,
            }}
          >
            {t('chat.account.noSaved', { platform: platformName(channel.platform) })}
          </Text>
        ) : null}
      </div>
    </anchored>
  )
}

interface ChatAccountControlProps extends AccountChoiceOptions {
  /** Non-empty while not connected. */
  statusText?: string
  statusColor: string | null
}

/** The chat's platform icon with its account as a badge; a click picks another saved account. */
export function ChatAccountControl({
  channel,
  account,
  pane,
  statusText,
  statusColor,
  onChosen,
}: ChatAccountControlProps) {
  const theme = useTheme()
  const { t } = useT()
  const choice = useAccountChoice({ channel, account, pane, onChosen })
  const testKey = pane?.panel.id ?? channel.id
  const color = platformColor(channel.platform)
  const description = [
    `${platformName(channel.platform)} · ${channel.displayName}`,
    account ? t('chat.account.sendingAs', { name: account.username }) : t('chat.account.readOnly'),
    statusText,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <div
            testId={`chat-account-${testKey}`}
            role="button"
            aria-label={t('chat.account.chooseFor', { channel: channel.displayName })}
            aria-expanded={choice.open}
            tabIndex={0}
            onClick={choice.toggle}
            onKeyDown={(event) => {
              if (event.key === 'enter' || event.key === 'space') {
                event.preventDefault()
                event.stopPropagation()
                choice.toggle()
              }
            }}
            style={{
              width: 26,
              height: 28,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 5,
              backgroundColor: account ? withAlpha(color, 0.16) : 'transparent',
              opacity: choice.busy ? 0.5 : 1,
              cursor: choice.busy ? 'default' : 'pointer',
              userSelect: 'none',
              hover: { backgroundColor: account ? withAlpha(color, 0.26) : theme.fillHover },
            }}
          >
            <PlatformIcon
              platform={channel.platform}
              size={14}
              color={account ? color : theme.text2}
            />
            <div style={{ position: 'absolute', right: 0, bottom: 1 }}>
              {account ? (
                <AccountAvatar account={account} size={12} ring={theme.bg} />
              ) : (
                <Icon name="lock" size={8} color={theme.text2} />
              )}
            </div>
            {statusColor ? (
              <div
                style={{
                  position: 'absolute',
                  right: 1,
                  top: 2,
                  width: 5,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: statusColor,
                }}
              />
            ) : null}
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={6}
          style={{
            backgroundColor: theme.popover,
            borderWidth: 1,
            borderColor: theme.dialogBorder,
            borderRadius: 6,
            paddingTop: 5,
            paddingBottom: 5,
            paddingLeft: 8,
            paddingRight: 8,
            maxWidth: 320,
          }}
        >
          <Text style={{ fontSize: 12, color: statusColor ?? theme.text }}>{description}</Text>
        </TooltipContent>
      </Tooltip>
      {choice.open ? (
        <AccountMenu
          channel={channel}
          account={account}
          side="top"
          choice={choice}
          testKey={testKey}
        />
      ) : null}
    </div>
  )
}

/**
 * The pane's account in the chat header. Shown only while it matters: the pane sends with an
 * account other than the platform default, or the same chat is open next to it with another one.
 */
export function PaneAccountChip({
  channel,
  account,
  pane,
}: {
  channel: WatchedChannel
  account: Account
  pane?: AccountChoiceOptions['pane']
}) {
  const theme = useTheme()
  const { t } = useT()
  const choice = useAccountChoice({ channel, account, pane, onChosen: () => {} })
  const testKey = pane?.panel.id ?? channel.id
  return (
    <div style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
      <div
        testId={`pane-account-${testKey}`}
        role="button"
        aria-label={t('chat.account.chooseFor', { channel: channel.displayName })}
        aria-expanded={choice.open}
        tabIndex={0}
        onClick={choice.toggle}
        onKeyDown={(event) => {
          if (event.key === 'enter' || event.key === 'space') {
            event.preventDefault()
            event.stopPropagation()
            choice.toggle()
          }
        }}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          height: 22,
          maxWidth: 150,
          paddingLeft: 3,
          paddingRight: 8,
          borderRadius: 11,
          backgroundColor: theme.fill,
          opacity: choice.busy ? 0.5 : 1,
          cursor: choice.busy ? 'default' : 'pointer',
          userSelect: 'none',
          hover: { backgroundColor: theme.fillHover },
        }}
      >
        <AccountAvatar account={account} size={16} />
        <Text
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: theme.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {`@${account.username}`}
        </Text>
      </div>
      {choice.open ? (
        <AccountMenu
          channel={channel}
          account={account}
          side="bottom"
          choice={choice}
          testKey={testKey}
        />
      ) : null}
    </div>
  )
}
