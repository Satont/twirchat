import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useGpuixRequired,
  type PublicInstance,
} from '@gpuix/react'
import { PLATFORM_COMMAND_NAMES } from '@twirchat/shared/channel-tools'
/**
 * Message composer — port of ChatInput.vue.
 *
 * Native <textarea> (auto-growing, Enter submits). Autocomplete keyboard
 * navigation intercepts keys via onKeyDown; while the popup is open the
 * textarea's onSubmit is removed, otherwise GPUI's Enter→submit action would
 * consume the key before the popup sees it.
 */
import type {
  Account,
  AppSettings,
  NormalizedChatMessage,
  Platform,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

import { normalizePrivateCommand } from '../../services/private-commands'
import {
  parseAutoTranslationCommand,
  parseTranslationCommand,
  resolveChannelTranslation,
  type TranslationResult,
} from '../../services/translation'
import {
  chatChannelKey,
  createChatMessageTargets,
  messageLength,
  messageLengthLimit,
  ownChatSendTargets,
} from '../../views/main/utils/chat-send-targets'
import { resolveUserCardCommand, type UserCardTarget } from '../../views/main/utils/chatCommands'
import { sanitizeDisplayText, truncateGraphemes } from '../../views/shared/utils/display-text'
import { useBackend } from '../backend/context'
import {
  commandApplies,
  runCommandActions,
  expandCustomCommand,
  parsePluginCommand,
  type CommandContext,
} from '../commands'
import { useAutocomplete, parseToken, replaceToken } from '../hooks/use-autocomplete'
import { nativeWindow, type NativeTextAction } from '../native-window'
import {
  registerSupplementalHotkeys,
  useHotkeyContext,
  useHotkeyRoute,
} from '../state/action-bindings'
import { aliasesStore, streamStatusStore } from '../state/app'
import { emoteStore } from '../state/app'
import {
  autoTranslationLanguagesStore,
  browseComposerHistory,
  completeComposerSend,
  composerTranslationMode,
  findComposerHistory,
  initialComposerHistoryMatch,
  cycleComposerHistoryMatch,
  composerStore,
  editComposer,
  EMPTY_COMPOSER,
  parseComposerCommand,
  setAutoTranslationLanguage,
  updateComposer,
} from '../state/composer'
import { useComposerFocusRegistration } from '../state/composer-focus'
import { useStore, useStoreSelector } from '../state/create-store'
import { customCommandsStore, loadCustomCommands } from '../state/custom-commands'
import { useTextInputFocusTracking } from '../state/focus'
import { loadTranslationSettings, translationSettingsStore } from '../state/translation'
import { lastWhisperRecipientStore, rememberWhisperRecipient } from '../state/twitch-activities'
import { useWindowScope } from '../state/window-scope'
import { accent, platformColor, withAlpha, type Theme } from '../theme'
import { useTheme } from '../theme-context'
import { AutocompletePopup } from './AutocompletePopup'
import { ComposerImageUpload } from './ComposerImageUpload'
import { EmotePicker } from './EmotePicker'
import { ActionButton } from './ui/Form'
import { Icon, PlatformIcon } from './ui/Icon'
import { Text } from './ui/Text'

/** Show the length counter this many characters before the limit. */
const LENGTH_WARNING_MARGIN = 50
interface OutgoingPreviewItem {
  platform: Platform
  channelId: string
  text: string
  targetLanguage?: string
}
interface PreparedAction {
  (): void | Promise<void>
  previewItems?: OutgoingPreviewItem[]
  previewRequired?: boolean
  localOnly?: boolean
}
interface OutgoingPreview {
  input: string
  signature: string
  items: OutgoingPreviewItem[]
  status: 'loading' | 'ready' | 'error'
  error?: string
  keepInput?: boolean
}

type OutgoingTranslationOverride =
  | { kind: 'command'; targetLanguage: string }
  | { kind: 'channel'; languages: ReadonlyMap<string, string> }

export type ComposerCommandRunner = (text: string) => Promise<void>
interface HistorySearch {
  query: string
  direction: -1 | 1
  loop: boolean
  anchor: number
  index: number
}
interface ComposerFrameSize {
  id: number | null
  width: number
  height: number
}

export interface ChatInputProps {
  accounts: Account[]
  settings: AppSettings
  statuses: Partial<Record<import('@twirchat/shared/types').Platform, PlatformStatusInfo>>
  watchedChannel?: WatchedChannel | null
  watchedChannelStatus?: PlatformStatusInfo | null
  replyTarget?: NormalizedChatMessage | null
  messages?: NormalizedChatMessage[]
  activePlatform?: Platform
  onActivePlatformChange?: (platform: Platform | null) => void
  composerKey?: string
  hotkeyContextId?: string
  hotkeyParentContextIds?: readonly string[]
  onCommandRunnerReady?: (runner: ComposerCommandRunner | null) => void
  onClearMessages?: () => void
  onCopyMessages?: () => void
  onPauseChange?: (paused: boolean) => void
  onToggleMentions?: () => void
  onSearch?: (query: string) => void
  onSend: (
    targets: {
      platform: Platform
      channelLogin: string
      text: string
      replyToMessageId?: string
    }[],
  ) => void | Promise<void>
  onSendWatched: (payload: {
    text: string
    channelId: string
    replyToMessageId?: string
  }) => void | Promise<void>
  onOpenUserCard: (target: UserCardTarget) => void
  onCancelReply: () => void
  onPlatformCommand?: (
    text: string,
    target: { platform: Platform; channelSlug: string },
  ) => Promise<void>
}

function connectionStatusText(status: string | undefined, channel: string, error?: string): string {
  switch (status) {
    case 'connecting':
      return `Connecting to ${channel}…`
    case 'disconnected':
      return `${channel} disconnected`
    case 'error':
      return error || `Could not connect to ${channel}`
    default:
      return ''
  }
}

export function ChatInput(props: ChatInputProps) {
  const theme = useTheme()
  const backend = useBackend()
  const customCommands = useStore(customCommandsStore)
  const [executing, setExecuting] = useState(false)
  const executingRef = useRef(false)
  const executionController = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      executionController.current?.abort()
    }
  }, [])
  const aliases = useStore(aliasesStore)
  const renderer = useGpuixRequired()
  const windowScope = useWindowScope()
  const textareaRef = useRef<PublicInstance | null>(null)
  const [composerSize, setComposerSize] = useState<ComposerFrameSize>({
    id: null,
    width: 0,
    height: 0,
  })
  const composerKey =
    props.composerKey ?? (props.watchedChannel ? `watched:${props.watchedChannel.id}` : 'home')
  useComposerFocusRegistration(
    composerKey,
    renderer,
    textareaRef,
    props.watchedChannel?.id ?? 'home',
  )
  const composer = useStoreSelector(
    composerStore,
    (states) => states.get(composerKey) ?? EMPTY_COMPOSER,
  )
  const text = composer.text
  const setText = (next: string | ((current: string) => string)) => {
    updateComposer(composerKey, (current) =>
      editComposer(current, typeof next === 'function' ? next(current.text) : next),
    )
  }
  const clearText = (expected?: string) => {
    updateComposer(composerKey, (current) =>
      expected !== undefined && current.text !== expected
        ? current
        : {
            ...current,
            text: '',
            historyIndex: null,
            savedDraft: null,
          },
    )
  }
  useEffect(() => {
    void loadCustomCommands(backend.api).catch(() => {})
  }, [backend])
  const [editorFocused, setEditorFocused] = useState(false)
  const editorFocusedRef = useRef(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const editorFocusTracking = useTextInputFocusTracking()
  const composerFocus = {
    onFocus() {
      editorFocusedRef.current = true
      setEditorFocused(true)
      editorFocusTracking.onFocus()
    },
    onBlur() {
      editorFocusedRef.current = false
      setEditorFocused(false)
      editorFocusTracking.onBlur()
    },
  }
  const searchFocus = useTextInputFocusTracking(setSearchFocused)
  const [historySearch, setHistorySearch] = useState<HistorySearch | null>(null)
  const historyMatches = useMemo(
    () => findComposerHistory(composer.history, historySearch?.query ?? ''),
    [composer.history, historySearch?.query],
  )
  const historySearchRef = useRef<PublicInstance | null>(null)
  const historySearchOpen = historySearch !== null
  const blurHistorySearch = useEffectEvent(() => searchFocus.onBlur())
  useEffect(() => {
    if (!historySearchOpen) blurHistorySearch()
  }, [historySearchOpen])
  const inputContextId = props.hotkeyContextId ?? `input:${composerKey}`
  useHotkeyRoute(
    [inputContextId, ...(props.hotkeyParentContextIds ?? [])],
    editorFocused || searchFocused,
  )
  useEffect(() => {
    if (historySearchOpen && historySearchRef.current)
      renderer.focusElement?.(historySearchRef.current.id)
  }, [historySearchOpen, renderer])
  useEffect(() => {
    setHistorySearch(null)
  }, [composerKey])
  const [commandError, setCommandError] = useState('')
  const translation = useStore(translationSettingsStore)
  const [outgoingPreview, setOutgoingPreview] = useState<OutgoingPreview | null>(null)
  const [commandTranslation, setCommandTranslation] = useState<TranslationResult | null>(null)
  const previewRevision = useRef({ value: 0 }).current
  const sendIntent = useRef<{ input: string; keepInput: boolean } | null>(null)
  useEffect(() => {
    if (sendIntent.current?.input !== text) sendIntent.current = null
  }, [text])
  useEffect(() => {
    void loadTranslationSettings(backend).catch(() => {})
  }, [backend])
  const [emotePickerOpen, setEmotePickerOpen] = useState(false)
  // Timestamp of the last outside-click dismissal: the same gesture ends in a
  // click on the trigger (mousedown closes, mouseup clicks) — swallow it.
  const emotePickerDismissedAt = useRef(0)

  // Focus the composer when a reply is initiated (matches the Vue build).
  useEffect(() => {
    if (props.replyTarget && textareaRef.current) {
      renderer.focusElement?.(textareaRef.current.id)
    }
  }, [props.replyTarget, renderer])

  const aliasMap = useMemo(() => {
    const map = new Map<import('@twirchat/shared/types').Platform, Map<string, string>>()
    for (const alias of aliases) {
      let inner = map.get(alias.platform)
      if (!inner) {
        inner = new Map()
        map.set(alias.platform, inner)
      }
      inner.set(alias.platformUserId, alias.alias)
    }
    return map
  }, [aliases])

  // ── Target chips (home tab: one per own platform) ────────────────────────

  const connectedPlatforms = useMemo(() => {
    if (props.watchedChannel) return []
    return ownChatSendTargets(props.accounts).map((target) => {
      const exactStatus = Object.values(props.statuses).find(
        (info) =>
          info?.platform === target.platform &&
          info.channelLogin?.toLowerCase() === target.channelLogin.toLowerCase(),
      )
      return {
        platform: target.platform,
        channelLogin: target.channelLogin,
        status: exactStatus?.status ?? 'connected',
        mode: exactStatus?.mode ?? 'authenticated',
        error: exactStatus?.error,
      }
    })
  }, [props.accounts, props.statuses, props.watchedChannel])

  const homeConnectionStatuses = connectedPlatforms.filter((p) => p.status !== 'connected')
  const sendablePlatforms = connectedPlatforms.filter(
    (p) => p.mode === 'authenticated' && p.status === 'connected',
  )
  const hasAnything = props.watchedChannel ? true : connectedPlatforms.length > 0
  const isDisabled = props.watchedChannel
    ? props.watchedChannelStatus?.mode !== 'authenticated' ||
      props.watchedChannelStatus.status !== 'connected'
    : !sendablePlatforms.some(
        (target) => !props.activePlatform || target.platform === props.activePlatform,
      )

  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({})
  const isEnabled = (platform: Platform): boolean => {
    const info = connectedPlatforms.find((p) => p.platform === platform)
    if (!info || info.mode !== 'authenticated') return false
    if (props.activePlatform) return platform === props.activePlatform
    return enabledMap[platform] !== false
  }
  const toggle = (platform: Platform) => {
    if (props.activePlatform) {
      props.onActivePlatformChange?.(null)
      return
    }
    const info = connectedPlatforms.find((p) => p.platform === platform)
    if (!info || info.mode !== 'authenticated') return
    setEnabledMap((current) => ({ ...current, [platform]: !isEnabled(platform) }))
  }

  // Over-limit messages are rejected by the platform after the fact; catch
  // them here, against the tightest limit of every platform it would go to.
  const targetPlatforms: Platform[] = props.watchedChannel
    ? [props.watchedChannel.platform]
    : sendablePlatforms
        .filter(
          (p) =>
            isEnabled(p.platform) &&
            (!props.replyTarget || p.platform === props.replyTarget.platform),
        )
        .map((p) => p.platform)
  const lengthLimit = messageLengthLimit(targetPlatforms)
  const length = messageLength(text.trim())
  const overLimit = lengthLimit !== null && length > lengthLimit
  const showLength = lengthLimit !== null && length > lengthLimit - LENGTH_WARNING_MARGIN

  const commandTargets = props.watchedChannel
    ? [{ platform: props.watchedChannel.platform, channelSlug: props.watchedChannel.channelSlug }]
    : connectedPlatforms
        .filter(
          (target) =>
            isEnabled(target.platform) &&
            target.status === 'connected' &&
            (!props.replyTarget || props.replyTarget.platform === target.platform),
        )
        .map((target) => ({ platform: target.platform, channelSlug: target.channelLogin }))

  function autoTranslationSignature(languages: ReadonlyMap<string, string>): string {
    if (languages.size === 0) return ''
    return commandTargets
      .map((target) => languages.get(chatChannelKey(target.platform, target.channelSlug)) ?? '')
      .join(',')
  }
  const autoTranslationKey = useStoreSelector(
    autoTranslationLanguagesStore,
    autoTranslationSignature,
  )

  function commandContext(input: string): CommandContext {
    const target = commandTargets.length === 1 ? commandTargets[0] : undefined
    const account = target
      ? props.accounts.find((candidate) => candidate.platform === target.platform)
      : undefined
    const selected = props.replyTarget
    const stream = target
      ? streamStatusStore.get().get(`${target.platform}:${target.channelSlug.toLowerCase()}`)
      : undefined
    const recent = target
      ? props.messages?.findLast((message) => message.platform === target.platform)
      : undefined
    return {
      platform: target?.platform,
      channel: target ? { name: target.channelSlug, id: recent?.channelId } : undefined,
      my: account ? { name: account.username, id: account.platformUserId } : undefined,
      user: selected
        ? { name: selected.author.username ?? selected.author.displayName, id: selected.author.id }
        : undefined,
      message: selected ? { id: selected.id, text: selected.text } : undefined,
      stream: stream ? { title: stream.title, game: stream.categoryName } : undefined,
      inputText: input,
      elementCopyText: selected?.text,
    }
  }

  const autocomplete = useAutocomplete({
    text,
    setText: (next) => {
      setText(next)
      setCommandError('')
    },
    messages: props.messages ?? [],
    watchedChannel: props.watchedChannel,
    statuses: props.statuses,
    aliasMap,
    customCommands: customCommands.commands.filter(
      (command) => commandTargets.length !== 1 || commandApplies(command, commandContext(text)),
    ),
  })
  const autocompleteActive = editorFocused && autocomplete.isOpen && !historySearch
  const autocompleteKey = useEffectEvent((key: 'up' | 'down' | 'enter' | 'tab' | 'escape') => {
    if (key === 'up') autocomplete.moveUp()
    else if (key === 'down') autocomplete.moveDown()
    else if (key === 'escape') autocomplete.close()
    else autocomplete.selectSuggestion(autocomplete.selectedIndex)
  })
  useEffect(() => {
    if (!autocompleteActive) return undefined
    return registerSupplementalHotkeys(
      windowScope,
      `autocomplete:${inputContextId}`,
      () =>
        editorFocusedRef.current && textareaRef.current
          ? [
              { id: 'previous', keys: ['up'], handler: () => autocompleteKey('up') },
              { id: 'next', keys: ['down'], handler: () => autocompleteKey('down') },
              { id: 'select-enter', keys: ['enter'], handler: () => autocompleteKey('enter') },
              { id: 'select-tab', keys: ['tab'], handler: () => autocompleteKey('tab') },
              { id: 'dismiss', keys: ['escape'], handler: () => autocompleteKey('escape') },
            ]
          : [],
      'beforeCustom',
    )
  }, [autocompleteActive, windowScope, inputContextId])

  // Validate the complete expansion before executing its first action.
  function privateAction(command: { text: string; recipient: string }): PreparedAction {
    const account = props.accounts.find((candidate) => candidate.platform === 'twitch')
    if (!account) throw new Error('Connect a Twitch account before sending a whisper.')
    const onPlatformCommand = props.onPlatformCommand
    if (!onPlatformCommand) throw new Error('Whispers are unavailable in this chat.')
    return async () => {
      await onPlatformCommand(command.text, {
        platform: 'twitch',
        channelSlug: account.username,
      })
      rememberWhisperRecipient(command.recipient)
    }
  }
  function protectedTerms(output: string, platform: Platform, channelId: string): string[] {
    const catalog = new Set(
      (emoteStore.get().get(`${platform}:${channelId}`) ?? []).map((entry) => entry.alias),
    )
    return output.split(/\s+/u).filter((word) => catalog.has(word))
  }
  async function prepareNormalOutput(
    output: string,
    override: OutgoingTranslationOverride,
  ): Promise<PreparedAction> {
    if (isDisabled) throw new Error('Connect to chat and log in before sending a message.')
    const targets = props.watchedChannel
      ? [
          {
            platform: props.watchedChannel.platform,
            channelLogin: props.watchedChannel.channelSlug,
            text: output,
            replyToMessageId: props.replyTarget?.id,
          },
        ]
      : createChatMessageTargets(sendablePlatforms, output, isEnabled, props.replyTarget)
    if (!targets.length) throw new Error('Select a connected platform before sending a message.')
    const settings = (await loadTranslationSettings(backend)).settings
    const isSlashCommand = output.trim().startsWith('/')
    let previewRequired = false
    const translated = await Promise.all(
      targets.map(async (target) => {
        const selected = resolveChannelTranslation(settings, target.platform, target.channelLogin)
        const autoLanguage =
          override.kind === 'channel' && override.languages.size > 0 && !isSlashCommand
            ? override.languages.get(chatChannelKey(target.platform, target.channelLogin))
            : undefined
        const targetLanguage = override.kind === 'command' ? override.targetLanguage : autoLanguage
        const mode = targetLanguage
          ? 'send'
          : isSlashCommand
            ? 'off'
            : composerTranslationMode(composer, selected.outgoingMode)
        if (mode === 'preview') previewRequired = true
        const result =
          mode === 'off'
            ? null
            : await backend.api.translateText({
                text: output,
                sourceLanguage: autoLanguage ? 'auto' : selected.sourceLanguage,
                targetLanguage: targetLanguage ?? selected.targetLanguage,
                protectedTerms: protectedTerms(output, target.platform, target.channelLogin),
              })
        const text = result ? result.text.replace(/[\r\n]+/gu, ' ').trim() : output
        const limit = messageLengthLimit([target.platform])
        if (!text.trim()) throw new Error('The translated message is empty. Nothing was sent.')
        if (limit !== null && messageLength(text.trim()) > limit)
          throw new Error(
            `The ${target.platform} message is too long after translation: ${limit} characters max. Nothing was sent.`,
          )
        return { ...target, text, language: result?.targetLanguage }
      }),
    )
    const watchedChannel = props.watchedChannel
    const watchedTarget = translated[0]
    if (watchedChannel && !watchedTarget) throw new Error('No watched chat target is available.')
    const action: PreparedAction =
      watchedChannel && watchedTarget
        ? () =>
            props.onSendWatched({
              text: watchedTarget.text,
              channelId: watchedChannel.id,
              replyToMessageId: watchedTarget.replyToMessageId,
            })
        : () => props.onSend(translated)
    return Object.assign(action, {
      previewRequired,
      previewItems: translated.map((target) => ({
        platform: target.platform,
        channelId: target.channelLogin,
        text: target.text,
        targetLanguage: target.language,
      })),
    })
  }
  function previewSignature(
    input: string,
    items: OutgoingPreviewItem[],
    autoTranslationLanguages: ReadonlyMap<string, string>,
  ): string {
    return JSON.stringify([
      input,
      items,
      commandTargets,
      props.replyTarget?.id,
      translation.value.settings,
      composer.translateOnSend,
      autoTranslationSignature(autoTranslationLanguages),
    ])
  }
  const commandTargetKey = JSON.stringify(commandTargets)
  const syncOutgoingPreview = useEffectEvent(() => {
    const token = ++previewRevision.value
    const input = text
    const languages = autoTranslationLanguagesStore.get()
    setOutgoingPreview(null)
    if (
      !input.trim() ||
      input.trim().startsWith('/') ||
      /^\.w(?:\s|$)/iu.test(input.trim()) ||
      isDisabled
    )
      return
    if (
      !commandTargets.some(
        (target) =>
          (languages.size === 0 ||
            !languages.has(chatChannelKey(target.platform, target.channelSlug))) &&
          composerTranslationMode(
            composer,
            resolveChannelTranslation(
              translation.value.settings,
              target.platform,
              target.channelSlug,
            ).outgoingMode,
          ) === 'preview',
      )
    )
      return
    const expansion = expandCustomCommand(
      input.trim(),
      customCommands.commands,
      commandContext(input),
    )
    if (!expansion.ok || expansion.matched) return
    setOutgoingPreview({
      input,
      signature: '',
      items: [],
      status: 'loading',
      keepInput: sendIntent.current?.input === input && sendIntent.current.keepInput,
    })
    const timer = setTimeout(() => {
      void prepareNormalOutput(input.trim(), { kind: 'channel', languages })
        .then((action) => {
          if (previewRevision.value !== token || !mounted.current) return
          const items = action.previewItems ?? []
          setOutgoingPreview({
            input,
            signature: previewSignature(input, items, languages),
            items,
            status: 'ready',
            keepInput: sendIntent.current?.input === input && sendIntent.current.keepInput,
          })
        })
        .catch((error: unknown) => {
          if (previewRevision.value === token && mounted.current)
            setOutgoingPreview({
              input,
              signature: '',
              items: [],
              status: 'error',
              keepInput: sendIntent.current?.input === input && sendIntent.current.keepInput,
              error: error instanceof Error ? error.message : String(error),
            })
        })
    }, 600)
    return () => {
      clearTimeout(timer)
      previewRevision.value++
    }
  })
  useEffect(
    () => syncOutgoingPreview(),
    [
      text,
      commandTargetKey,
      translation.value.settings,
      composer.translateOnSend,
      autoTranslationKey,
      props.replyTarget?.id,
      isDisabled,
      customCommands.commands,
    ],
  )

  async function prepareOutput(
    output: string,
    languages: ReadonlyMap<string, string>,
  ): Promise<PreparedAction> {
    const privateCommand = normalizePrivateCommand(output, lastWhisperRecipientStore.get())
    if (privateCommand) return privateAction(privateCommand)
    const autoTranslation = parseAutoTranslationCommand(output)
    if (autoTranslation) {
      const target = commandTargets[0]
      if (commandTargets.length !== 1 || !target)
        throw new Error('Select one platform before configuring auto-translation.')
      const key = chatChannelKey(target.platform, target.channelSlug)
      return Object.assign(() => setAutoTranslationLanguage(key, autoTranslation.targetLanguage), {
        localOnly: true,
      })
    }
    const translationCommand = parseTranslationCommand(output)
    if (translationCommand) {
      const nestedPrivate = normalizePrivateCommand(
        translationCommand.text,
        lastWhisperRecipientStore.get(),
      )
      if (nestedPrivate) {
        const body = nestedPrivate.text.replace(/^\/w\s+\S+\s+/iu, '')
        const result = await backend.api.translateText({
          text: body,
          targetLanguage: translationCommand.targetLanguage,
        })
        const text = `/w ${nestedPrivate.recipient} ${result.text.replace(/[\r\n]+/gu, ' ').trim()}`
        if (translationCommand.mode === 'send')
          return privateAction({ recipient: nestedPrivate.recipient, text })
        return Object.assign(() => setCommandTranslation({ ...result, text }), { localOnly: true })
      }
      if (translationCommand.mode === 'send')
        return prepareNormalOutput(translationCommand.text, {
          kind: 'command',
          targetLanguage: translationCommand.targetLanguage,
        })
      const result = await backend.api.translateText({
        text: translationCommand.text,
        targetLanguage: translationCommand.targetLanguage,
        protectedTerms: currentChannelInfo
          ? protectedTerms(
              translationCommand.text,
              currentChannelInfo.platform,
              currentChannelInfo.channelId,
            )
          : [],
      })
      return Object.assign(() => setCommandTranslation(result), { localOnly: true })
    }
    const local = parseComposerCommand(output)
    if (local) {
      if (local.name !== 'search' && local.argument) throw new Error(`Usage: /${local.name}`)
      const onPauseChange = props.onPauseChange
      const onSearch = props.onSearch
      const action = (() => {
        switch (local.name) {
          case 'clearmessages':
            return props.onClearMessages
          case 'copy':
            return props.onCopyMessages
          case 'pause':
            return onPauseChange ? () => onPauseChange(true) : undefined
          case 'resume':
            return onPauseChange ? () => onPauseChange(false) : undefined
          case 'mentions':
            return props.onToggleMentions
          case 'search':
            return onSearch ? () => onSearch(local.argument) : undefined
        }
      })()
      if (!action) throw new Error('This command is unavailable in this chat.')
      return Object.assign(action, { localOnly: true })
    }
    const userCard = resolveUserCardCommand(output, props.messages ?? [], aliasMap)
    if (userCard) {
      if (!userCard.ok)
        throw new Error(
          userCard.error === 'missing-query'
            ? 'Usage: /user @nickname'
            : userCard.error === 'ambiguous'
              ? 'Multiple users match that nickname.'
              : 'No user found for that nickname.',
        )
      return Object.assign(() => props.onOpenUserCard(userCard.target), { localOnly: true })
    }
    const commandName = output.match(/^\/([^\s]+)/)?.[1]?.toLowerCase()
    if (commandName && PLATFORM_COMMAND_NAMES.some((name) => name === commandName)) {
      const target = commandTargets[0]
      if (commandTargets.length !== 1 || !target)
        throw new Error('Select one platform before running a platform command.')
      const onPlatformCommand = props.onPlatformCommand
      if (!onPlatformCommand) throw new Error('Platform commands are unavailable in this chat.')
      return () => onPlatformCommand(output, target)
    }
    if (commandName && backend.plugins?.hasCommand(commandName)) {
      const plugins = backend.plugins
      const invocation = parsePluginCommand(output)
      if (invocation) {
        const watched = props.watchedChannel
        const target = commandTargets.length === 1 ? commandTargets[0] : undefined
        const channel = watched
          ? {
              platform: watched.platform,
              id: watched.channelSlug,
              name: watched.displayName,
              watchedChannelId: watched.id,
            }
          : target
            ? { platform: target.platform, id: target.channelSlug, name: target.channelSlug }
            : null
        return Object.assign(
          () =>
            plugins.runCommand(invocation.name, { text: output, args: invocation.args, channel }),
          { localOnly: true },
        )
      }
    }
    return prepareNormalOutput(output, { kind: 'channel', languages })
  }

  async function send(
    confirmTranslation = false,
    options: {
      input?: string
      keepInput?: boolean
      propagateError?: boolean
      requireComplete?: boolean
    } = {},
  ): Promise<void> {
    const input = options.input ?? composerStore.get().get(composerKey)?.text ?? ''
    const keepInput = options.keepInput ?? false
    const trimmed = input.trim()
    if (!trimmed) return
    const languages = autoTranslationLanguagesStore.get()
    if (executingRef.current) {
      const error = new Error('A message or command is already being prepared.')
      setCommandError(error.message)
      if (options.propagateError) throw error
      return
    }
    sendIntent.current = { input, keepInput }
    executingRef.current = true
    const cancellation = new AbortController()
    executionController.current = cancellation
    setExecuting(true)
    setCommandError('')
    try {
      await loadCustomCommands(backend.api)
      const directPrivate = normalizePrivateCommand(trimmed, lastWhisperRecipientStore.get())
      const expansion = directPrivate
        ? ({ ok: true, matched: false, outputs: [directPrivate.text] } satisfies ReturnType<
            typeof expandCustomCommand
          >)
        : expandCustomCommand(trimmed, customCommandsStore.get().commands, commandContext(input))
      if (!expansion.ok) throw new Error(expansion.error)
      if (expansion.matched && commandTargets.length > 1)
        throw new Error('Select one platform before running a custom command.')
      const actions = await Promise.all(
        expansion.outputs.map((output) => prepareOutput(output, languages)),
      )
      if (cancellation.signal.aborted)
        throw new Error('The composer closed before the command completed.')
      const items = actions.flatMap((action) => action.previewItems ?? [])
      const signature = previewSignature(input, items, languages)
      const previewRequired = actions.some((action) => action.previewRequired)
      if (confirmTranslation && !previewRequired && outgoingPreview?.signature !== signature) {
        setOutgoingPreview(null)
        return
      }
      if (previewRequired && (!confirmTranslation || outgoingPreview?.signature !== signature)) {
        if (keepInput || (composerStore.get().get(composerKey)?.text ?? '') === input)
          setOutgoingPreview({ input, signature, items, status: 'ready', keepInput })
        if (options.requireComplete)
          throw new Error('Review the translation preview before sending this command.')
        return
      }
      await runCommandActions(actions, { signal: cancellation.signal })
      setOutgoingPreview(null)
      sendIntent.current = null
      setCommandError('')
      updateComposer(composerKey, (current) =>
        completeComposerSend(current, input, {
          keepInput,
          remember: !actions.every((action) => action.localOnly),
        }),
      )
    } catch (error) {
      if (mounted.current) setCommandError(error instanceof Error ? error.message : String(error))
      if (options.propagateError) throw error
    } finally {
      executingRef.current = false
      if (mounted.current) setExecuting(false)
    }
  }

  const commandRunner = useRef<ComposerCommandRunner | null>(null)
  commandRunner.current = (input) => {
    if (!mounted.current) return Promise.reject(new Error('The composer is closed.'))
    return send(false, { input, keepInput: true, propagateError: true, requireComplete: true })
  }
  const onCommandRunnerReady = props.onCommandRunnerReady
  useEffect(() => {
    onCommandRunnerReady?.((input) => {
      const runner = commandRunner.current
      return runner ? runner(input) : Promise.reject(new Error('The composer is closed.'))
    })
    return () => onCommandRunnerReady?.(null)
  }, [onCommandRunnerReady, composerKey])

  function finishHistorySearch(): void {
    setHistorySearch(null)
    if (textareaRef.current) renderer.focusElement?.(textareaRef.current.id)
  }
  function showHistoryMatch(next: HistorySearch): void {
    setHistorySearch(next)
    const current = composerStore.get().get(composerKey) ?? EMPTY_COMPOSER
    const match = findComposerHistory(current.history, next.query)[next.index]
    if (match)
      updateComposer(composerKey, (state) => ({
        ...state,
        text: match.text,
        historyIndex: match.historyIndex,
        savedDraft: state.savedDraft ?? state.text,
      }))
    autocomplete.close()
  }
  function cycleHistorySearch(direction: -1 | 1, loop: boolean): void {
    if (!historySearch) {
      const current = composerStore.get().get(composerKey) ?? EMPTY_COMPOSER
      setHistorySearch({
        query: '',
        direction,
        loop,
        anchor: current.historyIndex ?? current.history.length,
        index: -1,
      })
      autocomplete.close()
      return
    }
    const count = findComposerHistory(
      composerStore.get().get(composerKey)?.history ?? [],
      historySearch.query,
    ).length
    showHistoryMatch({
      ...historySearch,
      direction,
      loop,
      index: cycleComposerHistoryMatch(historySearch.index, count, direction, loop),
    })
  }
  function browseHistory(direction: -1 | 1): void {
    setHistorySearch(null)
    updateComposer(composerKey, (state) => browseComposerHistory(state, direction))
    autocomplete.close()
    setCommandError('')
    if (textareaRef.current) renderer.focusElement?.(textareaRef.current.id)
  }
  async function editorAction(action: NativeTextAction): Promise<void> {
    if (!(await nativeWindow(renderer).runTextInputAction(action)))
      throw new Error('This action is unavailable in the focused text editor.')
  }
  async function copyText(source: string): Promise<void> {
    const selectedChatText = renderer.getSelectedText?.() ?? ''
    if (source === 'auto' && selectedChatText) {
      await backend.api.copyText({ text: selectedChatText })
      return
    }
    if (source !== 'split') {
      if (await nativeWindow(renderer).runTextInputAction('copy')) return
      if (source === 'splitInput') throw new Error('Select text in the input before copying.')
    }
    if (selectedChatText) await backend.api.copyText({ text: selectedChatText })
    else if (props.onCopyMessages) props.onCopyMessages()
    else throw new Error('There is no chat text available to copy.')
  }
  useHotkeyContext({
    id: inputContextId,
    category: 'splitInput',
    handlers: {
      clear: () => {
        clearText()
        if (historySearch) finishHistorySearch()
        autocomplete.close()
        props.onCancelReply()
      },
      nextMessage: () => browseHistory(1),
      previousMessage: () => browseHistory(-1),
      openEmotesPopup: currentChannelInfoAvailable()
        ? () => {
            setHistorySearch(null)
            setEmotePickerOpen(true)
          }
        : null,
      paste: () => editorAction('paste'),
      redo: () => editorAction('redo'),
      selectAll: () => editorAction('selectAll'),
      selectWord: () => editorAction('selectWord'),
      toggleTranslateOnSend: commandTargets.length
        ? () => {
            const languages = autoTranslationLanguagesStore.get()
            const active = commandTargets.find((target) =>
              languages.has(chatChannelKey(target.platform, target.channelSlug)),
            )
            if (active) {
              if (commandTargets.length !== 1)
                throw new Error('Select one platform before turning off auto-translation.')
              setAutoTranslationLanguage(chatChannelKey(active.platform, active.channelSlug), null)
              return
            }
            const configured = commandTargets.some(
              (target) =>
                resolveChannelTranslation(
                  translation.value.settings,
                  target.platform,
                  target.channelSlug,
                ).outgoingMode !== 'off',
            )
            updateComposer(composerKey, (state) => ({
              ...state,
              translateOnSend: !(state.translateOnSend ?? configured),
            }))
          }
        : null,
      undo: () => editorAction('undo'),
      cancelReply: props.replyTarget ? props.onCancelReply : null,
      copy: ([source]) => {
        if (!source) throw new Error('Choose a copy source before running this shortcut.')
        return copyText(source)
      },
      cursorToStart: ([selection]) =>
        editorAction(selection === 'withSelection' ? 'selectToStart' : 'cursorToStart'),
      cursorToEnd: ([selection]) =>
        editorAction(selection === 'withSelection' ? 'selectToEnd' : 'cursorToEnd'),
      sendMessage: ([option]) =>
        send(false, { keepInput: option === 'keepInput', propagateError: true }),
      'incremental-search-history': ([direction, loop]) =>
        cycleHistorySearch(direction === 'backward' ? -1 : 1, loop === 'loop'),
    },
  })
  function currentChannelInfoAvailable(): boolean {
    return (
      !!props.watchedChannel ||
      ownChatSendTargets(props.accounts).some(
        (target) => !props.activePlatform || target.platform === props.activePlatform,
      )
    )
  }

  function placeholderText(): string {
    if (props.watchedChannel) {
      if (props.watchedChannelStatus?.mode !== 'authenticated') return 'Log in to send messages…'
      return `Message ${props.watchedChannel.displayName}…`
    }
    if (!hasAnything) return 'Connect an account…'
    if (isDisabled) return 'Log in to send messages…'
    return 'Send a message…'
  }

  const ownChannelTarget = ownChatSendTargets(props.accounts).find(
    (target) => !props.activePlatform || target.platform === props.activePlatform,
  )
  const currentChannelInfo = props.watchedChannel
    ? { platform: props.watchedChannel.platform, channelId: props.watchedChannel.channelSlug }
    : ownChannelTarget
      ? { platform: ownChannelTarget.platform, channelId: ownChannelTarget.channelLogin }
      : null

  const autoTranslationTargets = autoTranslationKey ? autoTranslationKey.split(',') : null
  return (
    <div
      style={{
        flexShrink: 0,
        borderTopWidth: 1,
        borderColor: theme.border,
        minWidth: 0,
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: 8,
        paddingRight: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        backgroundColor: theme.surface,
      }}
    >
      <ComposerImageUpload key={composerKey} editor={textareaRef} />
      {historySearch ? (
        <div
          testId="composer-history-search"
          style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          <Text style={{ fontSize: 10, color: theme.text2 }}>
            Search sent messages · Enter or Esc keeps the result
          </Text>
          <input
            ref={historySearchRef}
            testId="composer-history-query"
            value={historySearch.query}
            placeholder="Search message history…"
            {...searchFocus}
            onBlur={() => {
              searchFocus.onBlur()
              setHistorySearch(null)
            }}
            onChange={(event) => {
              const query = event.value ?? ''
              const matches = findComposerHistory(composer.history, query)
              showHistoryMatch({
                ...historySearch,
                query,
                index: initialComposerHistoryMatch(
                  matches,
                  historySearch.anchor,
                  historySearch.direction,
                  historySearch.loop,
                ),
              })
            }}
            onKeyDown={(event) => {
              if (event.key === 'escape' || event.key === 'enter' || event.key === 'tab') {
                event.preventDefault()
                finishHistorySearch()
              } else if (event.key === 'up' || event.key === 'down') {
                event.preventDefault()
                cycleHistorySearch(event.key === 'up' ? -1 : 1, historySearch.loop)
              }
            }}
            style={{
              width: '100%',
              height: 30,
              paddingLeft: 8,
              paddingRight: 8,
              fontSize: 12,
              color: theme.text,
              backgroundColor: theme.surface2,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 6,
            }}
          />
          <Text
            style={{
              fontSize: 10,
              color: historyMatches[historySearch.index] ? theme.text2 : theme.dangerText,
            }}
          >
            {!historySearch.query
              ? 'Type to search your sent messages'
              : historyMatches[historySearch.index]
                ? `${historySearch.index + 1}/${historyMatches.length}`
                : 'No match'}
          </Text>
        </div>
      ) : null}
      {autoTranslationTargets?.some(Boolean) ? (
        <div
          testId="auto-translation-status"
          style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          {commandTargets.map(({ platform, channelSlug }, index) => {
            const language = autoTranslationTargets[index]
            if (!language) return null
            const key = chatChannelKey(platform, channelSlug)
            const multiple = commandTargets.length > 1
            return (
              <div
                key={key}
                style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}
              >
                <Text style={{ fontSize: 10, color: theme.text2 }}>
                  {`Auto-translate${multiple ? ` ${platform}/${channelSlug}` : ''} → ${language}`}
                </Text>
                <ActionButton
                  testId={multiple ? `auto-translation-off-${platform}` : 'auto-translation-off'}
                  disabled={executing}
                  onClick={() => {
                    setAutoTranslationLanguage(key, null)
                    if (textareaRef.current) renderer.focusElement?.(textareaRef.current.id)
                  }}
                >
                  Turn off
                </ActionButton>
              </div>
            )
          })}
        </div>
      ) : composer.translateOnSend !== undefined ? (
        <Text
          style={{ fontSize: 10, color: theme.text2 }}
        >{`Translate on send: ${composer.translateOnSend ? 'on' : 'off'}`}</Text>
      ) : null}
      {commandTranslation ? (
        <div
          testId="translation-command-preview"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: 8,
            borderRadius: 6,
            backgroundColor: theme.fill,
            maxHeight: 160,
            overflowY: 'scroll',
            scrollbarColor: theme.scrollbar,
            scrollbarWidth: 4,
          }}
        >
          <Text
            style={{ fontSize: 10, color: theme.text2 }}
          >{`Translation preview · ${commandTranslation.sourceLanguage ?? 'auto'} → ${commandTranslation.targetLanguage}`}</Text>
          <Text style={{ fontSize: 12, color: theme.text }}>
            {truncateGraphemes(sanitizeDisplayText(commandTranslation.text), 5000)}
          </Text>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <ActionButton
              onClick={() => {
                setText(commandTranslation.text)
                setCommandTranslation(null)
                if (textareaRef.current) renderer.focusElement?.(textareaRef.current.id)
              }}
            >
              Insert translation
            </ActionButton>
            <ActionButton
              onClick={() =>
                void backend.api
                  .copyText({ text: commandTranslation.text })
                  .catch(() => setCommandError('Could not copy the translation.'))
              }
            >
              Copy translation
            </ActionButton>
            <ActionButton onClick={() => setCommandTranslation(null)}>Dismiss</ActionButton>
          </div>
        </div>
      ) : null}
      {outgoingPreview ? (
        <div
          testId="outgoing-translation-preview"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: 8,
            borderRadius: 6,
            backgroundColor: theme.fill,
            maxHeight: 180,
            overflowY: 'scroll',
            scrollbarColor: theme.scrollbar,
            scrollbarWidth: 4,
          }}
        >
          <Text style={{ fontSize: 10, color: theme.text2 }}>
            {outgoingPreview.status === 'loading'
              ? 'Preparing translation preview…'
              : 'Review the translated message before sending'}
          </Text>
          {outgoingPreview.items.map((item, index) => (
            <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <Text
                style={{ fontSize: 10, color: theme.text2 }}
              >{`${item.platform}/${item.channelId}${item.targetLanguage ? ` → ${item.targetLanguage}` : ''}`}</Text>
              <Text style={{ fontSize: 12, color: theme.text }}>
                {truncateGraphemes(sanitizeDisplayText(item.text), 5000)}
              </Text>
            </div>
          ))}
          {outgoingPreview.error ? (
            <Text style={{ fontSize: 11, color: theme.dangerText }}>{outgoingPreview.error}</Text>
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {outgoingPreview.status === 'ready' ? (
              <ActionButton
                primary
                disabled={executing}
                testId="send-translated-message"
                onClick={() =>
                  void send(true, {
                    input: outgoingPreview.input,
                    keepInput: outgoingPreview.keepInput,
                  })
                }
              >
                Send translated message
              </ActionButton>
            ) : outgoingPreview.status === 'error' ? (
              <ActionButton
                testId="retry-translated-message"
                disabled={executing}
                onClick={() =>
                  void send(false, {
                    input: outgoingPreview.input,
                    keepInput:
                      outgoingPreview.keepInput ||
                      (sendIntent.current?.input === outgoingPreview.input &&
                        sendIntent.current.keepInput),
                  })
                }
              >
                Retry translation
              </ActionButton>
            ) : null}
          </div>
        </div>
      ) : null}
      {/* Reply bar */}
      {props.replyTarget ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: theme.fill,
            borderRadius: 8,
            paddingTop: 5,
            paddingBottom: 5,
            paddingLeft: 10,
            paddingRight: 10,
          }}
        >
          <Icon name="reply" size={13} color={theme.link} />
          <Text
            style={{
              flexGrow: 1,
              fontSize: 12,
              color: theme.text2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {`Replying to ${sanitizeDisplayText(props.replyTarget.author.displayName)}: ${truncateGraphemes(
              sanitizeDisplayText(props.replyTarget.text),
              80,
            )}`}
          </Text>
          <div
            testId="cancel-reply"
            onClick={props.onCancelReply}
            style={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              borderRadius: 4,
              flexShrink: 0,
              hover: { backgroundColor: theme.fillHover },
            }}
          >
            <Icon name="close" size={16} color={theme.text2} />
          </div>
        </div>
      ) : null}

      {/* Connection state banners — only when the target chips (which carry
          a status dot + tooltip) are hidden by the channel-label setting. */}
      {!props.settings.showChannelLabel &&
      props.watchedChannel &&
      props.watchedChannelStatus &&
      props.watchedChannelStatus.status !== 'connected' ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            color: undefined,
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor:
                props.watchedChannelStatus.status === 'connecting'
                  ? theme.warningText
                  : props.watchedChannelStatus.status === 'error'
                    ? theme.dangerText
                    : theme.text2,
            }}
          />
          <Text
            style={{
              fontSize: 12,
              color:
                props.watchedChannelStatus.status === 'connecting'
                  ? theme.warningText
                  : props.watchedChannelStatus.status === 'error'
                    ? theme.dangerText
                    : theme.text2,
            }}
          >
            {connectionStatusText(
              props.watchedChannelStatus.status,
              props.watchedChannel.displayName,
              props.watchedChannelStatus.error,
            )}
          </Text>
        </div>
      ) : null}

      {!props.settings.showChannelLabel &&
      !props.watchedChannel &&
      homeConnectionStatuses.length > 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          {homeConnectionStatuses.map((p) => (
            <div
              key={p.platform}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: p.status === 'connecting' ? theme.warningText : theme.dangerText,
                }}
              />
              <Text
                style={{
                  fontSize: 12,
                  color: p.status === 'connecting' ? theme.warningText : theme.dangerText,
                }}
              >
                {connectionStatusText(p.status, p.channelLogin, p.error)}
              </Text>
            </div>
          ))}
        </div>
      ) : null}

      {/* Autocomplete + input row */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
        {autocompleteActive && composerSize.width > 0 ? (
          <AutocompletePopup
            suggestions={autocomplete.suggestions}
            selectedIndex={autocomplete.selectedIndex}
            mode={autocomplete.mode}
            onSelect={autocomplete.selectSuggestion}
            anchorId={composerSize.id}
            anchorWidth={composerSize.width}
          />
        ) : null}

        {commandError || showLength ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingLeft: 2,
              paddingRight: 2,
              paddingBottom: 2,
            }}
          >
            <Text style={{ flexGrow: 1, minWidth: 0, fontSize: 12, color: theme.dangerText }}>
              {commandError}
            </Text>
            {showLength ? (
              <Text
                style={{
                  flexShrink: 0,
                  fontSize: 12,
                  color: overLimit ? theme.dangerText : theme.text2,
                  fontWeight: overLimit ? 600 : 400,
                }}
              >
                {`${length}/${lengthLimit}`}
              </Text>
            ) : null}
          </div>
        ) : null}

        <div
          testId="composer-frame"
          onLayout={(event) => {
            const { elementId: id, width, height } = event
            if (id === undefined || width === undefined || height === undefined) return
            setComposerSize((current) =>
              current.id === id && current.width === width && current.height === height
                ? current
                : { id, width, height },
            )
          }}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
            backgroundColor: theme.surface2,
            borderWidth: 1,
            borderColor: editorFocused ? theme.link : theme.border,
            borderRadius: 8,
            paddingLeft: 5,
            paddingRight: 4,
            paddingTop: 4,
            paddingBottom: 4,
          }}
        >
          {props.watchedChannel || connectedPlatforms.length ? (
            <div
              testId="composer-targets"
              style={{
                display: 'flex',
                flexDirection: 'row',
                gap: 2,
                flexShrink: 0,
                alignSelf: 'flex-end',
                paddingRight: 5,
                borderRightWidth: 1,
                borderColor: theme.border,
              }}
            >
              {props.watchedChannel ? (
                <TargetControl
                  platform={props.watchedChannel.platform}
                  label={props.watchedChannel.displayName}
                  active={props.watchedChannelStatus?.mode === 'authenticated'}
                  anonymous={props.watchedChannelStatus?.mode !== 'authenticated'}
                  status={props.watchedChannelStatus?.status}
                  statusText={connectionStatusText(
                    props.watchedChannelStatus?.status,
                    props.watchedChannel.displayName,
                    props.watchedChannelStatus?.error,
                  )}
                />
              ) : (
                connectedPlatforms.map((target) => (
                  <TargetControl
                    key={target.platform}
                    platform={target.platform}
                    label={target.channelLogin}
                    active={isEnabled(target.platform)}
                    anonymous={target.mode !== 'authenticated'}
                    status={target.status}
                    statusText={connectionStatusText(
                      target.status,
                      target.channelLogin,
                      target.error,
                    )}
                    onClick={() => {
                      toggle(target.platform)
                      if (textareaRef.current) renderer.focusElement?.(textareaRef.current.id)
                    }}
                  />
                ))
              )}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            testId="chat-input"
            value={text}
            placeholder={placeholderText()}
            minRows={1}
            maxRows={5}
            onChange={(event) => {
              setText(event.value ?? '')
              setCommandError('')
            }}
            {...composerFocus}
            onSubmit={autocomplete.isOpen ? undefined : () => void send()}
            onKeyDown={(event) => {
              if (
                (event.key === 'up' || event.key === 'down') &&
                event.modifiers?.alt &&
                !event.modifiers.ctrl &&
                !event.modifiers.shift
              ) {
                if (
                  updateComposer(composerKey, (current) =>
                    browseComposerHistory(current, event.key === 'up' ? -1 : 1),
                  )
                ) {
                  event.preventDefault()
                  autocomplete.close()
                  setCommandError('')
                }
                return
              }
              if (!autocomplete.isOpen) {
                const up = event.key === 'up'
                const down = event.key === 'down'
                const browsing = composer.historyIndex !== null
                if (
                  (up || down) &&
                  !event.modifiers?.ctrl &&
                  !event.modifiers?.shift &&
                  (browsing || (up && text === ''))
                ) {
                  if (
                    updateComposer(composerKey, (current) =>
                      browseComposerHistory(current, up ? -1 : 1),
                    )
                  ) {
                    event.preventDefault()
                    setCommandError('')
                  }
                }
                return
              }
              if (event.key === 'up') {
                event.preventDefault()
                autocomplete.moveUp()
              } else if (event.key === 'down') {
                event.preventDefault()
                autocomplete.moveDown()
              } else if (event.key === 'enter' || event.key === 'tab') {
                // Without onSubmit Enter would insert a newline, and Tab
                // would move focus — both must only pick the suggestion.
                event.preventDefault()
                autocomplete.selectSuggestion(autocomplete.selectedIndex)
              } else if (event.key === 'escape') {
                autocomplete.close()
              }
            }}
            theme={{ caret: '#a78bfa' }}
            style={{
              flexGrow: 1,
              flexShrink: 1,
              flexBasis: 0,
              minWidth: 48,
              fontSize: 13,
              color: theme.text,
              lineHeight: 20,
              opacity: isDisabled ? 0.4 : 1,
            }}
          />

          <div
            testId="emote-button"
            onClick={() => {
              if (isDisabled) return
              if (Date.now() - emotePickerDismissedAt.current < 250) return
              setEmotePickerOpen((open) => !open)
            }}
            style={{
              flexShrink: 0,
              width: 28,
              height: 28,
              alignSelf: 'flex-end',
              borderRadius: 5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: isDisabled ? 'default' : 'pointer',
              opacity: isDisabled ? 0.3 : 1,
              backgroundColor: emotePickerOpen ? accent.tint15 : undefined,
              hover: { backgroundColor: theme.fillHover },
            }}
          >
            <Icon name="smile" size={16} color={emotePickerOpen ? theme.link : theme.text2} />
          </div>
        </div>
        {executing ? (
          <Text style={{ fontSize: 10, color: theme.text2, marginTop: 4 }}>Running command…</Text>
        ) : null}

        {/* Emote picker overlay */}
        {emotePickerOpen && currentChannelInfo ? (
          <EmotePicker
            platform={currentChannelInfo.platform}
            channelId={currentChannelInfo.channelId}
            useSessionCache={props.settings.emoteSessionCache}
            onSelect={(alias) => {
              // GPUIX's native textarea does not expose the caret position,
              // so emotes append at the end (the Vue build inserted at caret).
              setText((current) => {
                const token = parseToken(current)
                if (token.mode === 'emote') {
                  return replaceToken(current, {
                    type: 'emote',
                    label: alias,
                    imageUrl: '',
                    animated: false,
                  })
                }
                return `${current}${current.endsWith(' ') || current === '' ? '' : ' '}${alias} `
              })
              setEmotePickerOpen(false)
            }}
            onClose={() => {
              emotePickerDismissedAt.current = Date.now()
              setEmotePickerOpen(false)
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

function statusDotColor(status: string | undefined, theme: Theme): string | null {
  if (status === 'connecting') return theme.warningText
  if (status === 'error' || status === 'disconnected') return theme.dangerText
  return null
}

function TargetControl({
  platform,
  label,
  active,
  anonymous,
  status,
  statusText,
  onClick,
}: {
  platform: Platform
  label: string
  active: boolean
  anonymous: boolean
  status?: string
  /** Non-empty while not connected — shown as a dot + tooltip. */
  statusText?: string
  onClick?: () => void
}) {
  const theme = useTheme()
  const color = platformColor(platform)
  const [hovered, setHovered] = useState(false)
  const effectiveHover = hovered && !anonymous && !active
  const dotColor = statusDotColor(status, theme)
  const tint = active || effectiveHover ? color : theme.text2

  const control = (
    <div
      testId={`composer-target-${platform}`}
      tabIndex={onClick && !anonymous ? 0 : undefined}
      onClick={anonymous ? undefined : onClick}
      onKeyDown={(event) => {
        if (!anonymous && onClick && (event.key === 'enter' || event.key === 'space')) {
          event.preventDefault()
          event.stopPropagation()
          onClick()
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 24,
        height: 28,
        flexShrink: 0,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 5,
        backgroundColor: active
          ? withAlpha(color, 0.16)
          : effectiveHover
            ? theme.fillHover
            : 'transparent',
        cursor: anonymous || !onClick ? 'default' : 'pointer',
        opacity: anonymous ? 0.45 : 1,
        userSelect: 'none',
      }}
    >
      <PlatformIcon platform={platform} size={14} color={tint} />
      {anonymous ? (
        <div style={{ position: 'absolute', right: 1, bottom: 1 }}>
          <Icon name="lock" size={8} color={theme.text2} />
        </div>
      ) : dotColor ? (
        <div
          style={{
            position: 'absolute',
            right: 2,
            bottom: 2,
            width: 5,
            height: 5,
            borderRadius: 3,
            backgroundColor: dotColor,
          }}
        />
      ) : null}
    </div>
  )
  const description = `${platform[0]?.toUpperCase()}${platform.slice(1)} · ${label}${anonymous ? ' · Log in to send' : onClick ? (active ? ' · Sending here' : ' · Click to enable') : ''}${statusText ? ` · ${statusText}` : ''}`

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
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
        <Text style={{ fontSize: 12, color: dotColor ?? theme.text }}>{description}</Text>
      </TooltipContent>
    </Tooltip>
  )
}
