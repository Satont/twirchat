import { PLATFORM_COMMAND_NAMES } from '@twirchat/shared/channel-tools'
import type {
  NormalizedChatMessage,
  Platform,
  PlatformStatusInfo,
  WatchedChannel,
} from '@twirchat/shared/types'
/**
 * React port of composables/useAutocomplete.ts.
 * Logic unchanged; Vue refs become React state + memos.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { emojiShortcodeSuggestions } from '../../services/emoji-shortcodes'
import { AUTO_TRANSLATION_COMMAND, isAutoTranslationCommand } from '../../services/translation'
import type { TwirCommand, TwirCommandTarget } from '../../services/twir-commands'
import {
  parseToken,
  replaceToken,
  type AutocompleteSuggestion,
  type CommandSuggestion,
  type EmoteSuggestion,
  type MentionSuggestion,
  type ParsedToken,
} from '../../views/main/utils/autocompleteUtils'
import { fuzzyFilter } from '../../views/main/utils/fuzzyFilter'
import { sanitizeDisplayText } from '../../views/shared/utils/display-text'
import { useBackend } from '../backend/context'
import {
  isTwirReloadCommand,
  TWIR_RELOAD_COMMAND_NAME,
  type CustomCommandDefinition,
} from '../commands'
import { emoteStore, loadEmotes } from '../state/app'
import { useStore, useStoreSelector } from '../state/create-store'
import {
  emotePreferencesStore,
  favoriteEmoteKey,
  loadEmotePreferences,
} from '../state/emote-preferences'
import { runUiTask } from './run-ui-task'

export { parseToken, replaceToken }
export type { AutocompleteSuggestion, EmoteSuggestion, MentionSuggestion }

type AliasMap = Map<Platform, Map<string, string>>

interface TwirSuggestions {
  targets: readonly TwirCommandTarget[]
  commands: ReadonlyMap<string, TwirCommand>
  revision: number
}

const EMPTY_MENTION_SUGGESTIONS: MentionSuggestion[] = []
const EMPTY_EMOTE_SUGGESTIONS: EmoteSuggestion[] = []
const EMPTY_TWIR_SUGGESTIONS: CommandSuggestion[] = []
const EMPTY_PLUGIN_COMMANDS: readonly string[] = []

const TWIR_RELOAD_SUGGESTION: CommandSuggestion = {
  type: 'command',
  label: `/${TWIR_RELOAD_COMMAND_NAME}`,
  insertText: `/${TWIR_RELOAD_COMMAND_NAME}`,
  description: 'Reload Twir commands for this chat',
}

function isComposerOnlyCommand(name: string): boolean {
  const invocation = `/${name}`
  return isAutoTranslationCommand(invocation) || isTwirReloadCommand(invocation)
}

const COMMAND_SUGGESTIONS: CommandSuggestion[] = [
  {
    type: 'command',
    label: AUTO_TRANSLATION_COMMAND,
    insertText: AUTO_TRANSLATION_COMMAND,
    description: 'Translate outgoing chat in this channel: <language|off>',
  },
  {
    type: 'command',
    label: '/translate',
    insertText: '/translate',
    description: 'Preview a translation of text locally',
  },
  {
    type: 'command',
    label: '/translateto',
    insertText: '/translateto',
    description: 'Preview a translation: <language> <text>',
  },
  {
    type: 'command',
    label: '/saytranslate',
    insertText: '/saytranslate',
    description: 'Translate and send: <language> <text>',
  },
  {
    type: 'command',
    label: '/tl',
    insertText: '/tl',
    description: 'Translate and send: <language> <text>',
  },
  {
    type: 'command',
    label: '.w',
    insertText: '.w',
    description: 'Whisper privately: <username> <message>',
  },
  {
    type: 'command',
    label: '/r',
    insertText: '/r',
    description: 'Whisper to the last recipient: <message>',
  },
  { type: 'command', label: '/$', insertText: '/$', description: 'Whisper a $ command to Supibot' },
  {
    type: 'command',
    label: '/_',
    insertText: '/_',
    description: 'Whisper an _ command to mm_sutilitybot',
  },
  { type: 'command', label: '/user', insertText: '/user', description: 'Open user card' },
  { type: 'command', label: '/search', insertText: '/search', description: 'Search this chat' },
  {
    type: 'command',
    label: '/mentions',
    insertText: '/mentions',
    description: 'Toggle mentions only',
  },
  { type: 'command', label: '/pause', insertText: '/pause', description: 'Pause this chat view' },
  { type: 'command', label: '/resume', insertText: '/resume', description: 'Resume live messages' },
  {
    type: 'command',
    label: '/copy',
    insertText: '/copy',
    description: 'Copy visible chat messages',
  },
  {
    type: 'command',
    label: '/clearmessages',
    insertText: '/clearmessages',
    description: 'Clear this view locally',
  },
]

export function useAutocomplete(params: {
  text: string
  setText: (next: string) => void
  messages: NormalizedChatMessage[]
  watchedChannel: WatchedChannel | null | undefined
  statuses: Partial<Record<Platform, PlatformStatusInfo>>
  aliasMap: AliasMap | undefined
  customCommands?: CustomCommandDefinition[]
  twirEnabled: boolean
  twirTargets?: readonly TwirCommandTarget[]
}) {
  const { text, setText, messages, watchedChannel, statuses, aliasMap } = params
  const backend = useBackend()
  const emotes = useStore(emoteStore)
  const emotePreferences = useStoreSelector(emotePreferencesStore, (state) => state.value)
  useEffect(() => {
    runUiTask(loadEmotePreferences(backend.api))
  }, [backend])

  const [closedQuery, setClosedQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const token = useMemo((): ParsedToken => {
    const trimmed = text.trimStart()
    if (trimmed.startsWith('.') && /^\.w?$/iu.test(trimmed))
      return { mode: 'command', query: trimmed }
    const query = trimmed.slice(1).toLowerCase()
    if (
      text.trimStart().startsWith('/') &&
      params.customCommands?.some(
        (command) => command.name.startsWith(query) && !isComposerOnlyCommand(command.name),
      )
    ) {
      return { mode: 'command', query }
    }
    return parseToken(text)
  }, [text, params.customCommands])
  const mode = token.mode
  const twirTargets = mode === 'twir-command' ? params.twirTargets : undefined
  const [twirSuggestions, setTwirSuggestions] = useState<TwirSuggestions>()
  const [twirRevision, setTwirRevision] = useState(0)
  useEffect(() => {
    if (!twirTargets) return undefined
    let current = true
    const load = async () => {
      const lists = await Promise.all(
        twirTargets.map((target) => backend.api.getTwirCommands(target)),
      )
      if (!current) return
      const commands = new Map<string, TwirCommand>()
      for (const list of lists) {
        for (const command of list) {
          const key = command.name.toLowerCase()
          if (!commands.has(key)) commands.set(key, command)
        }
      }
      setTwirSuggestions({ targets: twirTargets, commands, revision: twirRevision })
      setSelectedIndex(0)
    }
    runUiTask(load())
    return () => {
      current = false
    }
  }, [backend, twirTargets, twirRevision])
  const twirCommands =
    twirTargets &&
    twirSuggestions?.targets === twirTargets &&
    twirSuggestions.revision === twirRevision
      ? twirSuggestions.commands
      : undefined
  const twirQuery = mode === 'twir-command' ? token.query : undefined
  const twirMatches = useMemo(() => {
    if (!twirCommands || twirQuery === undefined) return EMPTY_TWIR_SUGGESTIONS
    const matches: CommandSuggestion[] = []
    for (const [name, command] of twirCommands) {
      if (!name.startsWith(twirQuery)) continue
      const label = `!${command.name}`
      matches.push({
        type: 'command',
        label,
        insertText: label,
        description: sanitizeDisplayText(command.description ?? ''),
      })
      if (matches.length === 15) break
    }
    return matches
  }, [twirCommands, twirQuery])
  const completingCommand = mode === 'command'
  const [pluginCommands, setPluginCommands] = useState(EMPTY_PLUGIN_COMMANDS)
  useEffect(() => {
    if (!completingCommand || !backend.plugins) return undefined
    const plugins = backend.plugins
    const refresh = () => setPluginCommands(plugins.commandNames())
    const unsubscribe = backend.events.on('plugins_changed', refresh)
    refresh()
    return unsubscribe
  }, [backend, completingCommand])
  const query = token.query
  const queryKey = mode === 'command' ? `/${query}` : mode === 'twir-command' ? `!${query}` : query
  const mentionCompletionActive = mode === 'mention' && query.length > 0
  const emoteCompletionActive = mode === 'emote' && query.length > 0
  const connectedChannel = watchedChannel
    ? undefined
    : Object.values(statuses).find((info) => info?.channelLogin && info.status === 'connected')
  const platform = watchedChannel?.platform ?? connectedChannel?.platform
  const channelId = watchedChannel?.channelSlug ?? connectedChannel?.channelLogin

  const mentionSuggestions = useMemo((): MentionSuggestion[] => {
    if (!mentionCompletionActive) return EMPTY_MENTION_SUGGESTIONS
    const seen = new Set<string>()
    const result: MentionSuggestion[] = []

    // Newest authors first.
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (!msg) continue
      const displayName = msg.author.displayName
      const lower = displayName.toLowerCase()
      const dedupKey = msg.author.id
        ? `${msg.platform}:${msg.author.id}`
        : `${msg.platform}:${lower}`
      if (seen.has(dedupKey)) continue
      seen.add(dedupKey)

      const alias = msg.author.id ? aliasMap?.get(msg.platform)?.get(msg.author.id) : undefined
      result.push({
        type: 'mention',
        label: alias || displayName,
        insertLabel: displayName,
        color: msg.author.color ?? null,
        description: msg.author.username
          ? `@${msg.author.username} • ${msg.platform}`
          : msg.platform,
        platform: msg.platform,
        platformUserId: msg.author.id,
        displayName,
        username: msg.author.username,
        avatarUrl: msg.author.avatarUrl,
        currentAlias: alias,
      })
    }
    return result
  }, [mentionCompletionActive, messages, aliasMap])

  const emoteSuggestions = useMemo((): EmoteSuggestion[] => {
    if (!emoteCompletionActive || !platform || !channelId) return EMPTY_EMOTE_SUGGESTIONS
    const favorites = new Set(emotePreferences.favorites.map(favoriteEmoteKey))
    const entries = [...(emotes.get(`${platform}:${channelId}`) ?? [])].sort(
      (a, b) =>
        Number(favorites.has(favoriteEmoteKey(b))) - Number(favorites.has(favoriteEmoteKey(a))),
    )
    return entries.map((e) => ({
      type: 'emote',
      label: e.alias,
      imageUrl: e.imageUrl,
      animated: e.animated,
    }))
  }, [emoteCompletionActive, emotes, platform, channelId, emotePreferences.favorites])

  const suggestions = useMemo((): AutocompleteSuggestion[] => {
    if (!mode) return []
    if (mode === 'twir-command') return twirMatches
    if (mode === 'command') {
      const custom: CommandSuggestion[] = (params.customCommands ?? [])
        .filter((command) => !isComposerOnlyCommand(command.name))
        .map((command) => ({
          type: 'command',
          label: `/${command.name}`,
          insertText: `/${command.name}`,
          description: command.template.replace(/\n/g, ' · '),
        }))
      const commands = [...custom, ...COMMAND_SUGGESTIONS]
      if (params.twirEnabled) commands.push(TWIR_RELOAD_SUGGESTION)
      if (pluginCommands.length) {
        const reserved = new Set<string>([
          ...commands.map((command) => command.label.slice(1)),
          ...PLATFORM_COMMAND_NAMES,
          'w',
          'whisper',
          TWIR_RELOAD_COMMAND_NAME,
        ])
        for (const name of pluginCommands) {
          if (reserved.has(name)) continue
          commands.push({
            type: 'command',
            label: `/${name}`,
            insertText: `/${name}`,
            description: 'Plugin command',
          })
        }
      }
      if (!query) return commands.slice(0, 15)
      return fuzzyFilter(commands, query).slice(0, 15)
    }
    if (!query) return []
    if (mode === 'mention') {
      return fuzzyFilter(mentionSuggestions, query).slice(0, 15)
    }
    const emoteMatches = fuzzyFilter(emoteSuggestions, query).slice(
      0,
      emotePreferences.emojiCompletion ? 10 : 15,
    )
    const emojis = emotePreferences.emojiCompletion
      ? fuzzyFilter(emojiShortcodeSuggestions, query.replace(/:$/, '')).slice(0, 5)
      : []
    return [...emoteMatches, ...emojis]
  }, [
    mode,
    query,
    twirMatches,
    mentionSuggestions,
    emoteSuggestions,
    params.customCommands,
    params.twirEnabled,
    pluginCommands,
    emotePreferences.emojiCompletion,
  ])

  const isOpen = suggestions.length > 0 && queryKey !== closedQuery

  // Reset the closed memory on every edit.
  const prevText = useRef(text)
  useEffect(() => {
    if (prevText.current !== text) {
      prevText.current = text
      setClosedQuery('')
      setSelectedIndex(0)
    }
  }, [text])

  // Load emotes for the active channel.
  useEffect(() => {
    if (!platform || !channelId) return
    runUiTask(loadEmotes(backend, platform, channelId))
  }, [platform, channelId, backend])

  function selectSuggestion(index: number): void {
    const s = suggestions[index]
    if (!s) return
    setText(s.type === 'command' ? `${s.insertText} ` : replaceToken(text, s))
    setSelectedIndex(0)
    setClosedQuery('')
  }

  function moveUp(): void {
    if (suggestions.length === 0) return
    setSelectedIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
  }

  function moveDown(): void {
    if (suggestions.length === 0) return
    setSelectedIndex((i) => (i >= suggestions.length - 1 ? 0 : i + 1))
  }

  function close(): void {
    setClosedQuery(queryKey)
    setSelectedIndex(0)
  }

  return {
    suggestions,
    isOpen,
    selectedIndex,
    mode,
    selectSuggestion,
    moveUp,
    moveDown,
    close,
    invalidateTwirSuggestions: () => setTwirRevision((revision) => revision + 1),
  }
}
