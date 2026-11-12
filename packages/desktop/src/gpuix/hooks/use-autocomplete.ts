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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { emojiShortcodeSuggestions } from '../../services/emoji-shortcodes'
import type { FossabotCommandTarget } from '../../services/fossabot-commands'
import type { JeetbotCommand, JeetbotCommandTarget } from '../../services/jeetbot-commands'
import type { PublicBotCommand } from '../../services/public-bot-commands'
import type { SupibotCommandTarget } from '../../services/supibot-commands'
import { AUTO_TRANSLATION_COMMAND, isAutoTranslationCommand } from '../../services/translation'
import type { TwirCommand, TwirCommandTarget } from '../../services/twir-commands'
import {
  createPrefixedBotCommandIndex,
  matchPrefixedBotCommands,
  mergeBotCommandMatches,
  parseToken,
  replaceToken,
  type ArgumentSuggestion,
  type AutocompleteSuggestion,
  type BotCommandSource,
  type CommandSuggestion,
  type EmoteSuggestion,
  type MentionSuggestion,
  type ParsedToken,
} from '../../views/main/utils/autocompleteUtils'
import {
  argumentHintText,
  argumentSignature,
  argumentSummary,
  currentArgument,
  findBotCommand,
  matchArgumentOptions,
  matchSubcommands,
  parseBotInvocation,
  resolveArgumentPosition,
  suggestedCommandName,
  twitchMentionArguments,
  type SignaturePart,
} from '../../views/main/utils/botCommandArguments'
import { bareEmoteQuery, rankEmoteMatches } from '../../views/main/utils/emoteCompletion'
import { fuzzyFilter } from '../../views/main/utils/fuzzyFilter'
import { sanitizeDisplayText } from '../../views/shared/utils/display-text'
import { useBackend } from '../backend/context'
import {
  isJeetbotReloadCommand,
  isTwirReloadCommand,
  JEETBOT_RELOAD_COMMAND_NAME,
  TWIR_RELOAD_COMMAND_NAME,
  type CustomCommandDefinition,
} from '../commands'
import { translatorFor, useT } from '../i18n'
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

interface JeetbotSuggestions {
  target: JeetbotCommandTarget
  commands: readonly JeetbotCommand[]
  revision: number
}

interface PublicBotSuggestions<Target, Command extends PublicBotCommand> {
  target: Target
  commands: readonly Command[]
}

/** Signature help for the bot-command argument being typed. */
export interface BotArgumentHint {
  signature: SignaturePart[]
  description: string
}

const EMPTY_MENTION_SUGGESTIONS: MentionSuggestion[] = []
const EMPTY_EMOTE_SUGGESTIONS: EmoteSuggestion[] = []
const EMPTY_BOT_SUGGESTIONS: CommandSuggestion[] = []
const EMPTY_ARGUMENT_SUGGESTIONS: ArgumentSuggestion[] = []
const EMPTY_JEETBOT_COMMANDS: readonly JeetbotCommand[] = []
const MENTION_LIMIT = 15
const EMPTY_PLUGIN_COMMANDS: readonly string[] = []

type Translate = ReturnType<typeof useT>['t']

function twirReloadSuggestion(t: Translate): CommandSuggestion {
  return {
    type: 'command',
    label: `/${TWIR_RELOAD_COMMAND_NAME}`,
    insertText: `/${TWIR_RELOAD_COMMAND_NAME}`,
    description: t('commands.autocomplete.twirReload'),
  }
}

function jeetbotReloadSuggestion(t: Translate): CommandSuggestion {
  return {
    type: 'command',
    label: `/${JEETBOT_RELOAD_COMMAND_NAME}`,
    insertText: `/${JEETBOT_RELOAD_COMMAND_NAME}`,
    description: t('commands.autocomplete.jeetbotReload'),
  }
}

function isComposerOnlyCommand(name: string): boolean {
  const invocation = `/${name}`
  return (
    isAutoTranslationCommand(invocation) ||
    isTwirReloadCommand(invocation) ||
    isJeetbotReloadCommand(invocation)
  )
}

/** Recent chat authors, newest first, one entry per platform user. */
function recentAuthors(
  messages: readonly NormalizedChatMessage[],
  aliasMap: AliasMap | undefined,
): MentionSuggestion[] {
  const seen = new Set<string>()
  const result: MentionSuggestion[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue
    const displayName = msg.author.displayName
    const lower = displayName.toLowerCase()
    const dedupKey = msg.author.id ? `${msg.platform}:${msg.author.id}` : `${msg.platform}:${lower}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)

    const alias = msg.author.id ? aliasMap?.get(msg.platform)?.get(msg.author.id) : undefined
    result.push({
      type: 'mention',
      label: alias || displayName,
      insertLabel: displayName,
      color: msg.author.color ?? null,
      description: msg.author.username ? `@${msg.author.username} • ${msg.platform}` : msg.platform,
      platform: msg.platform,
      platformUserId: msg.author.id,
      displayName,
      username: msg.author.username,
      avatarUrl: msg.author.avatarUrl,
      currentAlias: alias,
    })
  }
  return result
}

function jeetbotCommandSuggestion(name: string, command: JeetbotCommand): CommandSuggestion {
  const summary = argumentSummary(command)
  const description = sanitizeDisplayText(command.description)
  return {
    type: 'command',
    label: `!${name}`,
    insertText: `!${name}`,
    description: summary && description ? `${summary} · ${description}` : summary || description,
    source: 'jeetbot',
  }
}

function usePublicBotCommands<Target, Command extends PublicBotCommand>(
  getCommands: (target: Target) => Promise<readonly Command[]>,
  target: Target | undefined,
): readonly Command[] | undefined {
  const [suggestions, setSuggestions] = useState<PublicBotSuggestions<Target, Command>>()
  useEffect(() => {
    if (target === undefined) return undefined
    let current = true
    const load = async () => {
      const commands = await getCommands(target)
      if (current) setSuggestions({ target, commands })
    }
    runUiTask(load())
    return () => {
      current = false
    }
  }, [getCommands, target])
  return suggestions?.target === target ? suggestions?.commands : undefined
}

function appendPublicBotCommandMatches(
  matches: CommandSuggestion[],
  commands: readonly PublicBotCommand[] | undefined,
  source: BotCommandSource,
  query: string,
): void {
  if (!commands) return
  for (const { name, aliasFor } of commands) {
    if (!name.toLowerCase().startsWith(query)) continue
    const label = `!${name}`
    matches.push({
      type: 'command',
      label,
      insertText: label,
      description: aliasFor ? `!${aliasFor}` : '',
      source,
    })
  }
}

function commandSuggestions(t: Translate): CommandSuggestion[] {
  return [
    {
      type: 'command',
      label: AUTO_TRANSLATION_COMMAND,
      insertText: AUTO_TRANSLATION_COMMAND,
      description: t('commands.autocomplete.translateChannel'),
    },
    {
      type: 'command',
      label: '/translate',
      insertText: '/translate',
      description: t('commands.autocomplete.translatePreview'),
    },
    {
      type: 'command',
      label: '/translateto',
      insertText: '/translateto',
      description: t('commands.autocomplete.translateTo'),
    },
    {
      type: 'command',
      label: '/saytranslate',
      insertText: '/saytranslate',
      description: t('commands.autocomplete.sayTranslate'),
    },
    {
      type: 'command',
      label: '/tl',
      insertText: '/tl',
      description: t('commands.autocomplete.sayTranslate'),
    },
    {
      type: 'command',
      label: '.w',
      insertText: '.w',
      description: t('commands.autocomplete.whisper'),
    },
    {
      type: 'command',
      label: '/r',
      insertText: '/r',
      description: t('commands.autocomplete.whisperLast'),
    },
    {
      type: 'command',
      label: '/$',
      insertText: '/$',
      description: t('commands.autocomplete.supibot'),
    },
    {
      type: 'command',
      label: '/_',
      insertText: '/_',
      description: t('commands.autocomplete.sutilitybot'),
    },
    {
      type: 'command',
      label: '/user',
      insertText: '/user',
      description: t('commands.autocomplete.userCard'),
    },
    {
      type: 'command',
      label: '/search',
      insertText: '/search',
      description: t('commands.autocomplete.search'),
    },
    {
      type: 'command',
      label: '/mentions',
      insertText: '/mentions',
      description: t('commands.autocomplete.mentions'),
    },
    {
      type: 'command',
      label: '/pause',
      insertText: '/pause',
      description: t('commands.autocomplete.pause'),
    },
    {
      type: 'command',
      label: '/resume',
      insertText: '/resume',
      description: t('commands.autocomplete.resume'),
    },
    {
      type: 'command',
      label: '/copy',
      insertText: '/copy',
      description: t('commands.autocomplete.copy'),
    },
    {
      type: 'command',
      label: '/clearmessages',
      insertText: '/clearmessages',
      description: t('commands.autocomplete.clear'),
    },
  ]
}

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
  jeetbotEnabled: boolean
  /** Twitch chat to complete jeetbot commands for; absent while not typing a `!command`. */
  jeetbotChannelLogin?: string
  /** Twitch user ID of the account this chat sends with: jeetbot lists what it may run. */
  jeetbotUserId?: string
  fossabotChannelLogin?: string
  fossabotTwitchChannelId?: string
  nightbotChannelLogin?: string
  potatChannelLogin?: string
  supibotChannelLogin?: string
  supibotUserLogin?: string
}) {
  const { text, setText, messages, watchedChannel, statuses, aliasMap } = params
  const backend = useBackend()
  const { language } = useT()
  const t = useMemo(() => translatorFor(language), [language])
  const emotes = useStore(emoteStore)
  const emotePreferences = useStoreSelector(emotePreferencesStore, (state) => state.value)
  useEffect(() => {
    runUiTask(loadEmotePreferences(backend.api))
  }, [backend])

  const [closedQuery, setClosedQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  // Set once the user moves through the list; until then an unprompted list selects nothing.
  const [navigated, setNavigated] = useState(false)

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
  const twirTargets = token.mode === 'bot-command' ? params.twirTargets : undefined
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

  const invocation = useMemo(() => parseBotInvocation(text), [text])
  const jeetbotChannelLogin =
    token.mode === 'bot-command' || invocation ? params.jeetbotChannelLogin : undefined
  const jeetbotUserId = params.jeetbotUserId
  const jeetbotTarget = useMemo(
    (): JeetbotCommandTarget | undefined =>
      jeetbotChannelLogin
        ? { channelLogin: jeetbotChannelLogin, userId: jeetbotUserId }
        : undefined,
    [jeetbotChannelLogin, jeetbotUserId],
  )
  const [jeetbotSuggestions, setJeetbotSuggestions] = useState<JeetbotSuggestions>()
  const [jeetbotRevision, setJeetbotRevision] = useState(0)
  useEffect(() => {
    if (!jeetbotTarget) return undefined
    let current = true
    const load = async () => {
      const commands = await backend.api.getJeetbotCommands(jeetbotTarget)
      if (!current) return
      setJeetbotSuggestions({ target: jeetbotTarget, commands, revision: jeetbotRevision })
      setSelectedIndex(0)
    }
    runUiTask(load())
    return () => {
      current = false
    }
  }, [backend, jeetbotTarget, jeetbotRevision])
  const jeetbotCommands =
    jeetbotTarget &&
    jeetbotSuggestions?.target === jeetbotTarget &&
    jeetbotSuggestions.revision === jeetbotRevision
      ? jeetbotSuggestions.commands
      : EMPTY_JEETBOT_COMMANDS
  const argumentPosition = useMemo(() => {
    if (!invocation) return null
    const command = findBotCommand(jeetbotCommands, invocation.name)
    return command ? resolveArgumentPosition(command, invocation) : null
  }, [invocation, jeetbotCommands])
  const activeArgument = argumentPosition ? currentArgument(argumentPosition) : undefined
  const argumentHint = useMemo((): BotArgumentHint | null => {
    if (!argumentPosition) return null
    return {
      signature: argumentSignature(argumentPosition),
      description: sanitizeDisplayText(argumentHintText(argumentPosition)),
    }
  }, [argumentPosition])

  const twirCommands =
    twirTargets &&
    twirSuggestions?.targets === twirTargets &&
    twirSuggestions.revision === twirRevision
      ? twirSuggestions.commands
      : undefined
  const botQuery = token.mode === 'bot-command' ? token.query : undefined
  const fossabotLogin = botQuery === undefined ? undefined : params.fossabotChannelLogin
  const fossabotChannelId = fossabotLogin ? params.fossabotTwitchChannelId : undefined
  const fossabotTarget = useMemo(
    (): FossabotCommandTarget | undefined =>
      fossabotLogin
        ? { channelLogin: fossabotLogin, twitchChannelId: fossabotChannelId }
        : undefined,
    [fossabotLogin, fossabotChannelId],
  )
  const fossabotCommands = usePublicBotCommands(backend.api.getFossabotCommands, fossabotTarget)
  const nightbotCommands = usePublicBotCommands(
    backend.api.getNightbotCommands,
    botQuery === undefined ? undefined : params.nightbotChannelLogin,
  )
  const potatCommands = usePublicBotCommands(backend.api.getPotatCommands, params.potatChannelLogin)
  const { supibotChannelLogin, supibotUserLogin } = params
  const supibotTarget = useMemo(
    (): SupibotCommandTarget | undefined =>
      supibotChannelLogin
        ? { channelLogin: supibotChannelLogin, userLogin: supibotUserLogin }
        : undefined,
    [supibotChannelLogin, supibotUserLogin],
  )
  const supibotCommands = usePublicBotCommands(backend.api.getSupibotCommands, supibotTarget)
  const potatCommandIndex = useMemo(
    () => (potatCommands?.length ? createPrefixedBotCommandIndex(potatCommands) : undefined),
    [potatCommands],
  )
  const supibotCommandIndex = useMemo(
    () => (supibotCommands?.length ? createPrefixedBotCommandIndex(supibotCommands) : undefined),
    [supibotCommands],
  )
  const twirMatches = useMemo(() => {
    if (!twirCommands || botQuery === undefined) return EMPTY_BOT_SUGGESTIONS
    const matches: CommandSuggestion[] = []
    for (const [name, command] of twirCommands) {
      if (!name.startsWith(botQuery)) continue
      const label = `!${command.name}`
      matches.push({
        type: 'command',
        label,
        insertText: label,
        description: sanitizeDisplayText(command.description ?? ''),
        source: 'twir',
      })
    }
    return matches
  }, [twirCommands, botQuery])
  const jeetbotMatches = useMemo(() => {
    if (botQuery === undefined) return EMPTY_BOT_SUGGESTIONS
    return jeetbotCommands.flatMap((command) => {
      const name = suggestedCommandName(command, botQuery)
      return name === undefined ? [] : [jeetbotCommandSuggestion(name, command)]
    })
  }, [jeetbotCommands, botQuery])
  const prefixedQuery = potatCommandIndex || supibotCommandIndex ? text : ''
  const botCommandMatches = useMemo(() => {
    if (botQuery === undefined && !prefixedQuery) return EMPTY_BOT_SUGGESTIONS
    const matches = mergeBotCommandMatches(twirMatches, jeetbotMatches)
    if (botQuery !== undefined) {
      appendPublicBotCommandMatches(matches, fossabotCommands, 'fossabot', botQuery)
      appendPublicBotCommandMatches(matches, nightbotCommands, 'nightbot', botQuery)
    }
    const potatMatches = potatCommandIndex
      ? matchPrefixedBotCommands(potatCommandIndex, prefixedQuery, 'potat')
      : EMPTY_BOT_SUGGESTIONS
    const supibotMatches = supibotCommandIndex
      ? matchPrefixedBotCommands(supibotCommandIndex, prefixedQuery, 'supibot')
      : EMPTY_BOT_SUGGESTIONS
    if (potatMatches.length || supibotMatches.length) {
      return matches.concat(potatMatches, supibotMatches)
    }
    return matches.length ? matches : EMPTY_BOT_SUGGESTIONS
  }, [
    twirMatches,
    jeetbotMatches,
    fossabotCommands,
    nightbotCommands,
    botQuery,
    potatCommandIndex,
    supibotCommandIndex,
    prefixedQuery,
  ])
  const completingCommand = token.mode === 'command'
  const [pluginCommands, setPluginCommands] = useState(EMPTY_PLUGIN_COMMANDS)
  useEffect(() => {
    if (!completingCommand || !backend.plugins) return undefined
    const plugins = backend.plugins
    const refresh = () => setPluginCommands(plugins.commandNames())
    const unsubscribe = backend.events.on('plugins_changed', refresh)
    refresh()
    return unsubscribe
  }, [backend, completingCommand])
  const mentionCompletionActive = token.mode === 'mention' && token.query.length > 0
  const emoteCompletionActive = token.mode === 'emote' && token.query.length > 0
  const mentionArgumentActive = activeArgument?.type === 'mention'
  const connectedChannel = watchedChannel
    ? undefined
    : Object.values(statuses).find((info) => info?.channelLogin && info.status === 'connected')
  const platform = watchedChannel?.platform ?? connectedChannel?.platform
  const channelId = watchedChannel?.channelSlug ?? connectedChannel?.channelLogin

  const mentionSuggestions = useMemo((): MentionSuggestion[] => {
    if (!mentionCompletionActive && !mentionArgumentActive) return EMPTY_MENTION_SUGGESTIONS
    return recentAuthors(messages, aliasMap)
  }, [mentionCompletionActive, mentionArgumentActive, messages, aliasMap])

  const partialArgument = invocation?.partial ?? ''
  const argumentSuggestions = useMemo((): ArgumentSuggestion[] => {
    if (!argumentPosition) return EMPTY_ARGUMENT_SUGGESTIONS
    if (argumentPosition.kind === 'subcommand') {
      return matchSubcommands(argumentPosition.command.subcommands, partialArgument).map(
        (subcommand) => ({
          type: 'argument',
          label: subcommand.name,
          insertText: subcommand.name,
          description: sanitizeDisplayText(subcommand.description),
        }),
      )
    }
    if (!activeArgument) return EMPTY_ARGUMENT_SUGGESTIONS
    if (activeArgument.type === 'mention')
      return twitchMentionArguments(mentionSuggestions, partialArgument).slice(0, MENTION_LIMIT)
    return matchArgumentOptions(activeArgument.options, partialArgument).map((option) => ({
      type: 'argument',
      label: sanitizeDisplayText(option.label),
      insertText: option.value,
      description: option.value === option.label ? '' : option.value,
    }))
  }, [argumentPosition, activeArgument, partialArgument, mentionSuggestions])

  const mode: ParsedToken['mode'] = argumentSuggestions.length
    ? 'bot-argument'
    : botCommandMatches.length
      ? 'bot-command'
      : token.mode
  // An optional argument lists its values before anything is typed, but selects none of them:
  // Enter still sends the bare command, arrows or Tab pick a value.
  const unprompted =
    mode === 'bot-argument' && !partialArgument && activeArgument?.required === false
  const activeIndex = unprompted && !navigated ? -1 : selectedIndex
  const query = token.query
  const queryKey =
    mode === 'bot-argument'
      ? text
      : mode === 'command'
        ? `/${query}`
        : mode === 'bot-command'
          ? prefixedQuery || `!${query}`
          : query

  const getEmoteSuggestions = useCallback((): EmoteSuggestion[] => {
    if (!platform || !channelId) return EMPTY_EMOTE_SUGGESTIONS
    const favorites = new Set(emotePreferences.favorites.map(favoriteEmoteKey))
    const entries = [...(emotes.get(`${platform}:${channelId}`) ?? [])]
      .filter((entry) => entry.locked !== true)
      .sort(
        (a, b) =>
          Number(favorites.has(favoriteEmoteKey(b))) - Number(favorites.has(favoriteEmoteKey(a))),
      )
    return entries.map((e) => ({
      type: 'emote',
      label: e.alias,
      imageUrl: e.imageUrl,
      animated: e.animated,
    }))
  }, [emotes, platform, channelId, emotePreferences.favorites])

  const emoteSuggestions = useMemo(
    () => (emoteCompletionActive ? getEmoteSuggestions() : EMPTY_EMOTE_SUGGESTIONS),
    [emoteCompletionActive, getEmoteSuggestions],
  )

  const suggestions = useMemo((): AutocompleteSuggestion[] => {
    if (!mode) return []
    if (mode === 'bot-argument') return argumentSuggestions
    if (mode === 'bot-command') return botCommandMatches
    if (mode === 'command') {
      const custom: CommandSuggestion[] = (params.customCommands ?? [])
        .filter((command) => !isComposerOnlyCommand(command.name))
        .map((command) => ({
          type: 'command',
          label: `/${command.name}`,
          insertText: `/${command.name}`,
          description: command.template.replace(/\n/g, ' · '),
        }))
      const commands = [...custom, ...commandSuggestions(t)]
      if (params.twirEnabled) commands.push(twirReloadSuggestion(t))
      if (params.jeetbotEnabled) commands.push(jeetbotReloadSuggestion(t))
      if (pluginCommands.length) {
        const reserved = new Set<string>([
          ...commands.map((command) => command.label.slice(1)),
          ...PLATFORM_COMMAND_NAMES,
          'w',
          'whisper',
          TWIR_RELOAD_COMMAND_NAME,
          JEETBOT_RELOAD_COMMAND_NAME,
        ])
        for (const name of pluginCommands) {
          if (reserved.has(name)) continue
          commands.push({
            type: 'command',
            label: `/${name}`,
            insertText: `/${name}`,
            description: t('commands.autocomplete.plugin'),
          })
        }
      }
      return fuzzyFilter(commands, query)
    }
    if (!query) return []
    if (mode === 'mention') {
      return fuzzyFilter(mentionSuggestions, query).slice(0, 15)
    }
    const emoteMatches = rankEmoteMatches(emoteSuggestions, query).slice(
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
    argumentSuggestions,
    botCommandMatches,
    mentionSuggestions,
    emoteSuggestions,
    params.customCommands,
    params.twirEnabled,
    params.jeetbotEnabled,
    pluginCommands,
    emotePreferences.emojiCompletion,
    t,
  ])

  const isOpen = suggestions.length > 0 && queryKey !== closedQuery

  // Reset the closed memory on every edit.
  const prevText = useRef(text)
  useEffect(() => {
    if (prevText.current !== text) {
      prevText.current = text
      setClosedQuery('')
      setSelectedIndex(0)
      setNavigated(false)
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
    setNavigated(false)
    setClosedQuery('')
  }

  function completeBareEmote(): boolean {
    if (mode !== null) return false
    const bareQuery = bareEmoteQuery(text)
    if (!bareQuery) return false
    const match = rankEmoteMatches(getEmoteSuggestions(), bareQuery)[0]
    if (!match) return false
    setText(`${text.slice(0, -bareQuery.length)}${match.label} `)
    return true
  }

  function moveUp(): void {
    if (suggestions.length === 0) return
    setSelectedIndex(activeIndex <= 0 ? suggestions.length - 1 : activeIndex - 1)
    setNavigated(true)
  }

  function moveDown(): void {
    if (suggestions.length === 0) return
    setSelectedIndex(activeIndex >= suggestions.length - 1 ? 0 : activeIndex + 1)
    setNavigated(true)
  }

  function close(): void {
    setClosedQuery(queryKey)
    setSelectedIndex(0)
    setNavigated(false)
  }

  return {
    suggestions,
    isOpen,
    /** -1 while an unprompted list selects nothing: Enter then sends instead of completing. */
    selectedIndex: activeIndex,
    mode,
    selectSuggestion,
    completeBareEmote,
    moveUp,
    moveDown,
    close,
    argumentHint,
    invalidateTwirSuggestions: () => setTwirRevision((revision) => revision + 1),
    invalidateJeetbotSuggestions: () => setJeetbotRevision((revision) => revision + 1),
  }
}
