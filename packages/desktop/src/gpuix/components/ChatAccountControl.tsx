import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react'
import type { Account, WatchedChannel } from '@twirchat/shared/types'
import { useRef, useState } from 'react'

import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useT } from '../i18n'
import { accountsStore, savedAccountsStore, showNotice, watchedChannelsStore } from '../state/app'
import { useStore } from '../state/create-store'
import { useOverlayClose } from '../state/overlays'
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

function AccountAvatar({ account, size, ring }: AccountAvatarProps) {
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
      avatarSize={size}
      objectFit="cover"
      style={frame}
      fallback={letter}
    />
  )
}

interface ChatAccountControlProps {
  channel: WatchedChannel
  /** The account the chat is signed in with, if any. */
  account: Account | undefined
  /** Non-empty while not connected. */
  statusText?: string
  statusColor: string | null
  onChosen: () => void
}

/** The chat's platform icon with its account as a badge; a click picks another saved account. */
export function ChatAccountControl({
  channel,
  account,
  statusText,
  statusColor,
  onChosen,
}: ChatAccountControlProps) {
  const theme = useTheme()
  const { t } = useT()
  const backend = useBackend()
  const saved = useStore(savedAccountsStore)
  const active = useStore(accountsStore)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // The mousedown that dismisses the menu ends in a click on the trigger; ignore that click.
  const dismissedAt = useRef(0)
  useOverlayClose(open, () => setOpen(false))
  const color = platformColor(channel.platform)
  const choices = saved.filter((candidate) => candidate.platform === channel.platform)
  const fallback = active.find((candidate) => candidate.platform === channel.platform)

  async function choose(next: Account): Promise<void> {
    setOpen(false)
    // Picking the default account follows later default changes instead of pinning it.
    const accountId = next.id === fallback?.id ? null : next.id
    if (accountId === (channel.accountId ?? null)) return onChosen()
    setBusy(true)
    try {
      const updated = await backend.api.setWatchedChannelAccount({ id: channel.id, accountId })
      watchedChannelsStore.modify((channels) =>
        channels.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      )
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
            testId={`chat-account-${channel.id}`}
            role="button"
            aria-label={t('chat.account.chooseFor', { channel: channel.displayName })}
            aria-expanded={open}
            tabIndex={0}
            onClick={toggle}
            onKeyDown={(event) => {
              if (event.key === 'enter' || event.key === 'space') {
                event.preventDefault()
                event.stopPropagation()
                toggle()
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
              opacity: busy ? 0.5 : 1,
              cursor: busy ? 'default' : 'pointer',
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
      {open ? (
        <anchored deferred side="top" align="start" gap={6}>
          <div
            role="menu"
            testId={`chat-account-${channel.id}-menu`}
            onMouseDownOutside={() => {
              dismissedAt.current = Date.now()
              setOpen(false)
            }}
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
            {choices.map((choice) => {
              const selected = choice.id === account?.id
              const pick = () => runUiTask(choose(choice))
              return (
                <div
                  key={choice.id}
                  role="menuitemradio"
                  aria-checked={selected}
                  testId={`chat-account-${channel.id}-${choice.id}`}
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
                  <AccountAvatar account={choice} size={18} />
                  <div
                    style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}
                  >
                    <Text style={{ fontSize: 12, color: theme.text }}>{`@${choice.username}`}</Text>
                    {choice.id === fallback?.id ? (
                      <Text style={{ fontSize: 11, color: theme.text2 }}>
                        {t('chat.account.default')}
                      </Text>
                    ) : null}
                  </div>
                  {selected ? <Icon name="check" size={12} color={color} /> : null}
                </div>
              )
            })}
            {choices.length === 0 ? (
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
      ) : null}
    </div>
  )
}
