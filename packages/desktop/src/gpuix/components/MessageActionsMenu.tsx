import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react'
import { PLATFORM_COMMAND_NAMES } from '@twirchat/shared/channel-tools'
import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { useEffect, useRef, useState } from 'react'

import { useBackend } from '../backend/context'
import {
  commandApplies,
  expandCustomCommand,
  runCommandActions,
  type CommandContext,
} from '../commands'
import { runUiTask } from '../hooks/run-ui-task'
import { useT } from '../i18n'
import { claimMessageRowClick } from '../message-row-click'
import type { IgnoreRule } from '../message-rules'
import { usePaneAccountId } from '../pane-account-context'
import { accountsStore, showNotice, streamStatusStore } from '../state/app'
import { chatRulesPreferences, chatRulesStore } from '../state/chat-rules'
import { useStoreSelector } from '../state/create-store'
import { customCommandsStore } from '../state/custom-commands'
import { useOverlayClose } from '../state/overlays'
import { requestMessageTranslation } from '../state/translation'
import { useTheme } from '../theme-context'
import { Icon } from './ui/Icon'
import { Text } from './ui/Text'

export function MessageActionsMenu({
  message,
  channelSlug,
  visible,
  onReply,
  onOpenUserCard,
  onSearch,
  request = 0,
  position,
  onMenuButtonClick,
  title,
  onHoverChange,
}: {
  message: NormalizedChatMessage
  channelSlug?: string
  visible: boolean
  onReply?: () => void
  onOpenUserCard?: () => void
  onSearch?: (query: string) => void
  request?: number
  position?: { x: number; y: number } | null
  onMenuButtonClick: () => void
  title?: string
  onHoverChange?: (hovered: boolean) => void
}) {
  const backend = useBackend()
  const paneAccountId = usePaneAccountId()
  const theme = useTheme()
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const commands = useStoreSelector(customCommandsStore, (state) => state.commands)
  const rules = useStoreSelector(chatRulesStore, (state) => state.value)
  const abort = useRef<AbortController | null>(null)
  useOverlayClose(open, () => setOpen(false))
  useEffect(() => {
    if (request) setOpen(true)
  }, [request])
  useEffect(() => () => abort.current?.abort(), [])
  const channel = channelSlug ?? message.channelId
  const account = accountsStore.get().find((candidate) => candidate.platform === message.platform)
  const stream = streamStatusStore.get().get(`${message.platform}:${channel.toLowerCase()}`)
  const context: CommandContext = {
    platform: message.platform,
    channel: { name: channel, id: message.channelId },
    my: account ? { name: account.username, id: account.platformUserId } : undefined,
    user: { name: message.author.username ?? message.author.displayName, id: message.author.id },
    message: { id: message.id, text: message.text },
    elementCopyText: message.text,
    stream: { title: stream?.title, game: stream?.categoryName },
  }
  const matching = commands.filter(
    (command) => command.showInMessageMenu && commandApplies(command, context),
  )
  const ignored = rules.ignores.some(
    (rule) =>
      rule.enabled &&
      rule.target === 'user' &&
      rule.userId === message.author.id &&
      rule.platform === message.platform &&
      (rule.action ?? 'hide') === 'hide',
  )
  async function action(run: () => Promise<unknown> | void) {
    setOpen(false)
    try {
      await run()
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : String(error), 5000)
    }
  }
  const copy = (text: string) => backend.api.copyText({ text })
  async function ignore() {
    const current = chatRulesStore.get().value
    const ignores: IgnoreRule[] = ignored
      ? current.ignores.filter(
          (rule) =>
            !(
              rule.target === 'user' &&
              rule.userId === message.author.id &&
              rule.platform === message.platform &&
              (rule.action ?? 'hide') === 'hide'
            ),
        )
      : [
          ...current.ignores,
          {
            id: crypto.randomUUID(),
            name: message.author.displayName,
            pattern: message.author.username || message.author.displayName || message.author.id,
            enabled: true,
            regex: false,
            caseSensitive: false,
            wholeWord: true,
            target: 'user',
            platform: message.platform,
            userId: message.author.id,
            placeholder: true,
            action: 'hide',
          },
        ]
    await chatRulesPreferences.save(backend.api, { ...current, ignores })
  }
  async function highlight() {
    const current = chatRulesStore.get().value
    await chatRulesPreferences.save(backend.api, {
      ...current,
      highlights: [
        ...current.highlights,
        {
          id: crypto.randomUUID(),
          name: t('chatMessages.actions.highlightRuleName', { name: message.author.displayName }),
          pattern: `author.user_id == ${JSON.stringify(message.author.id)} && platform.name == ${JSON.stringify(message.platform)}`,
          enabled: true,
          regex: false,
          caseSensitive: false,
          wholeWord: false,
          target: 'filter',
          color: '#a78bfa28',
          mentions: true,
          sound: false,
          flash: false,
        },
      ],
    })
  }
  async function runCustom(name: string) {
    const result = expandCustomCommand(`/${name}`, commands, context)
    if (!result.ok) throw new Error(result.error)
    if (!result.matched) throw new Error(t('chatMessages.actions.commandUnavailable'))
    abort.current?.abort()
    abort.current = new AbortController()
    await runCommandActions(
      result.outputs.map((text) => async () => {
        if (text.startsWith('/copytext ')) {
          await copy(text.slice(10))
          return
        }
        if (text.startsWith('/search ')) {
          onSearch?.(text.slice(8))
          return
        }
        if (text === '/user') {
          onOpenUserCard?.()
          return
        }
        const name = text.match(/^\/([a-z]+)/iu)?.[1]?.toLowerCase()
        if (name && PLATFORM_COMMAND_NAMES.some((command) => command === name)) {
          const response = await backend.api.executePlatformCommand({
            accountId: paneAccountId,
            platform: message.platform,
            channelSlug: channel,
            text,
          })
          if (response.message) showNotice('info', response.message, 6000)
        } else {
          if (name && name !== 'me')
            throw new Error(t('chatMessages.actions.unsupportedAction', { name }))
          await backend.api.sendMessage({ platform: message.platform, channelId: channel, text })
        }
      }),
      { signal: abort.current.signal },
    )
  }
  const item = (label: string, run: () => Promise<unknown> | void) => (
    <div
      onClick={(event) => {
        if (!claimMessageRowClick(event)) return
        runUiTask(action(run))
      }}
      style={{
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 10,
        paddingRight: 10,
        cursor: 'pointer',
        borderRadius: 4,
        hover: { backgroundColor: theme.fillHover },
      }}
    >
      <Text style={{ fontSize: 12, color: theme.text }}>{label}</Text>
    </div>
  )
  const cursorPosition = position ?? undefined
  return (
    <div style={{ position: 'relative', display: 'flex' }}>
      {title ? (
        <Tooltip delayDuration={250}>
          <TooltipTrigger asChild>
            <div
              testId="msg-more"
              onMouseEnter={() => {
                setHovered(true)
                onHoverChange?.(true)
              }}
              onMouseLeave={() => {
                setHovered(false)
                onHoverChange?.(false)
              }}
              onClick={(event) => {
                if (!claimMessageRowClick(event)) return
                onMenuButtonClick()
                setOpen((value) => !value)
              }}
              style={{
                padding: 3,
                borderRadius: 4,
                cursor: 'pointer',
                backgroundColor: visible || hovered || open ? theme.fill : 'transparent',
              }}
            >
              <Icon
                name="moreVertical"
                size={13}
                color={visible || hovered || open ? theme.text2 : 'transparent'}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            style={{
              backgroundColor: theme.popover,
              color: theme.text,
              padding: 7,
              borderRadius: 5,
            }}
          >
            <Text style={{ fontSize: 12, color: theme.text }}>{title}</Text>
          </TooltipContent>
        </Tooltip>
      ) : (
        <div
          testId="msg-more"
          onMouseEnter={() => {
            setHovered(true)
            onHoverChange?.(true)
          }}
          onMouseLeave={() => {
            setHovered(false)
            onHoverChange?.(false)
          }}
          onClick={(event) => {
            if (!claimMessageRowClick(event)) return
            onMenuButtonClick()
            setOpen((value) => !value)
          }}
          style={{
            padding: 3,
            borderRadius: 4,
            cursor: 'pointer',
            backgroundColor: visible || hovered || open ? theme.fill : 'transparent',
          }}
        >
          <Icon
            name="moreVertical"
            size={13}
            color={visible || hovered || open ? theme.text2 : 'transparent'}
          />
        </div>
      )}
      {open ? (
        <anchored
          deferred
          position={cursorPosition}
          side="bottom"
          align={cursorPosition ? 'start' : 'end'}
          gap={cursorPosition ? 0 : 4}
        >
          <div
            testId="message-actions-menu"
            onMouseDownOutside={() => setOpen(false)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              padding: 4,
              minWidth: 210,
              maxHeight: 430,
              overflowY: 'scroll',
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
            {onReply ? item(t('chatMessages.actions.reply'), onReply) : null}
            {onOpenUserCard ? item(t('chatMessages.actions.openUserCard'), onOpenUserCard) : null}
            {item(t('chatMessages.actions.copyMessage'), () => copy(message.text))}
            {item(t('chatMessages.actions.copyFullMessage'), () =>
              copy(
                `[${new Date(message.timestamp).toISOString()}] ${channel} ${message.author.displayName}: ${message.text}`,
              ),
            )}
            {item(t('chatMessages.actions.copyMessageJson'), () =>
              copy(JSON.stringify(message, null, 2)),
            )}
            {item(t('chatMessages.actions.translateMessage'), () =>
              requestMessageTranslation(backend, message, { channelId: channel, force: true }),
            )}
            {item(t('chatMessages.actions.copyUsername'), () =>
              copy(message.author.username ?? message.author.displayName),
            )}
            {item(t('chatMessages.actions.copyUserId'), () => copy(message.author.id))}
            {item(t('chatMessages.actions.copyMessageId'), () => copy(message.id))}
            {item(t('chatMessages.actions.copyTimestamp'), () =>
              copy(new Date(message.timestamp).toISOString()),
            )}
            {onSearch
              ? item(t('chatMessages.actions.findFromUser'), () =>
                  onSearch(
                    `from:${JSON.stringify(message.author.username ?? message.author.displayName)}`,
                  ),
                )
              : null}
            {item(
              ignored
                ? t('chatMessages.actions.stopIgnoringUser')
                : t('chatMessages.actions.ignoreUser'),
              ignore,
            )}
            {item(t('chatMessages.actions.highlightUser'), highlight)}
            {message.platform === 'twitch'
              ? item(t('chatMessages.actions.blockOnTwitch'), async () => {
                  await backend.api.executePlatformCommand({
                    accountId: paneAccountId,
                    platform: 'twitch',
                    channelSlug: channel,
                    text: `/block ${message.author.username ?? message.author.id}`,
                  })
                  if (!ignored) await ignore()
                })
              : null}
            {message.platform === 'twitch'
              ? item(t('chatMessages.actions.unblockOnTwitch'), async () => {
                  await backend.api.executePlatformCommand({
                    accountId: paneAccountId,
                    platform: 'twitch',
                    channelSlug: channel,
                    text: `/unblock ${message.author.username ?? message.author.id}`,
                  })
                  if (ignored) await ignore()
                })
              : null}
            {message.platform === 'twitch'
              ? item(t('chatMessages.actions.pinMessage'), () =>
                  backend.api.executeTwitchActivityAction({
                    action: 'pin_message',
                    channelSlug: channel,
                    messageId: message.id,
                    duration: 1200,
                  }),
                )
              : null}
            {matching.length ? (
              <div
                style={{ height: 1, backgroundColor: theme.border, marginTop: 4, marginBottom: 4 }}
              />
            ) : null}
            {matching.map((command) => (
              <div key={command.id}>{item(`/${command.name}`, () => runCustom(command.name))}</div>
            ))}
          </div>
        </anchored>
      ) : null}
    </div>
  )
}
