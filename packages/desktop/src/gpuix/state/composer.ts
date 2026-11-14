import type { Platform } from '@twirchat/shared/types'

import { JEETBOT_RELOAD_COMMAND_NAME, TWIR_RELOAD_COMMAND_NAME } from '../commands'
import type { Store } from './create-store'
import { createStore } from './create-store'
import { persistentResource } from './persistent-resources'

export interface ComposerState {
  text: string
  history: string[]
  historyIndex: number | null
  savedDraft: string | null
  translateOnSend?: boolean
  activePlatform?: Platform
  activeWatchedChannelId?: string
  disabledPlatforms?: ReadonlySet<Platform>
}

export const EMPTY_COMPOSER: ComposerState = {
  text: '',
  history: [],
  historyIndex: null,
  savedDraft: null,
}

const HISTORY_LIMIT = 100

// Session state survives tab/pane unmounts and `bun --hot` remounts.
export const composerStore = persistentResource('composers', () =>
  createStore<Map<string, ComposerState>>(new Map()),
)

export const autoTranslationLanguagesStore = persistentResource('autoTranslationLanguages', () =>
  createStore<ReadonlyMap<string, string>>(new Map()),
)

export function setAutoTranslationLanguage(channelKey: string, language: string | null): void {
  autoTranslationLanguagesStore.modify((current) => {
    if ((current.get(channelKey) ?? null) === language) return current
    const next = new Map(current)
    if (language === null) next.delete(channelKey)
    else next.set(channelKey, language)
    return next
  })
}

export function editComposer(state: ComposerState, text: string): ComposerState {
  return { ...state, text, historyIndex: null }
}

/** Appends a mention after the draft, keeping one separating space and room to keep typing. */
export function appendComposerMention(text: string, username: string): string {
  const name = username.trim().replace(/^@/u, '')
  if (!name) return text
  const separator = text.length > 0 && !/\s$/u.test(text) ? ' ' : ''
  return `${text}${separator}@${name} `
}

export type ComposerMentionTarget =
  | { kind: 'platform'; platform: Platform }
  | { kind: 'watched'; channelId: string }

/** Points the composer at the row's platform/channel so a mention cannot cross-post. */
export function retargetComposerForMention(
  state: ComposerState,
  target: ComposerMentionTarget,
): ComposerState {
  switch (target.kind) {
    case 'platform':
      return state.activePlatform === target.platform
        ? state
        : { ...state, activePlatform: target.platform }
    case 'watched':
      return state.activeWatchedChannelId === target.channelId
        ? state
        : { ...state, activeWatchedChannelId: target.channelId }
    default: {
      const exhaustive: never = target
      return exhaustive
    }
  }
}

export function rememberComposerMessage(state: ComposerState, text: string): ComposerState {
  const trimmed = text.trim()
  const history =
    trimmed && state.history.at(-1) !== trimmed
      ? [...state.history, trimmed].slice(-HISTORY_LIMIT)
      : state.history
  return { ...state, text: '', history, historyIndex: null, savedDraft: null }
}

export function browseComposerHistory(state: ComposerState, direction: -1 | 1): ComposerState {
  if (state.history.length === 0) return state
  if (direction === -1) {
    const index = Math.max(0, (state.historyIndex ?? state.history.length) - 1)
    if (index === state.historyIndex) return state
    return {
      ...state,
      text: state.history[index] ?? state.text,
      historyIndex: index,
      savedDraft: state.savedDraft ?? state.text,
    }
  }
  // Editing a recalled message leaves the original unsent draft recoverable.
  if (state.historyIndex === null || state.historyIndex === state.history.length - 1) {
    if (state.savedDraft === null) return state
    return { ...state, text: state.savedDraft, historyIndex: null, savedDraft: null }
  }
  const index = state.historyIndex + 1
  return { ...state, text: state.history[index] ?? state.text, historyIndex: index }
}

export function updateComposer(
  key: string,
  update: (state: ComposerState) => ComposerState,
): boolean {
  const current = composerStore.get().get(key) ?? EMPTY_COMPOSER
  const next = update(current)
  if (next === current) return false
  composerStore.modify((states) => new Map(states).set(key, next))
  return true
}

type LocalCommandName =
  | 'clearmessages'
  | 'copy'
  | 'pause'
  | 'resume'
  | 'mentions'
  | 'search'
  | typeof TWIR_RELOAD_COMMAND_NAME
  | typeof JEETBOT_RELOAD_COMMAND_NAME

export interface ComposerCommand {
  name: LocalCommandName
  argument: string
}

const LOCAL_COMMANDS = new Set<LocalCommandName>([
  'clearmessages',
  'copy',
  'pause',
  'resume',
  'mentions',
  'search',
  TWIR_RELOAD_COMMAND_NAME,
  JEETBOT_RELOAD_COMMAND_NAME,
])

function isLocalCommand(value: string): value is LocalCommandName {
  return Array.from(LOCAL_COMMANDS).some((command) => command === value)
}

export function parseComposerCommand(text: string): ComposerCommand | null {
  const match = text.trim().match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i)
  if (!match) return null
  const name = match[1]?.toLowerCase()
  if (!name || !isLocalCommand(name)) return null
  return { name, argument: match[2]?.trim() ?? '' }
}

export interface ComposerHistoryMatch {
  historyIndex: number
  text: string
}

export function findComposerHistory(
  history: readonly string[],
  query: string,
): ComposerHistoryMatch[] {
  if (!query) return []
  const folded = query.toLocaleLowerCase()
  return history.flatMap((text, historyIndex) =>
    text.toLocaleLowerCase().includes(folded) ? [{ historyIndex, text }] : [],
  )
}

export function initialComposerHistoryMatch(
  matches: readonly ComposerHistoryMatch[],
  anchor: number,
  direction: -1 | 1,
  loop: boolean,
): number {
  const index =
    direction === -1
      ? matches.findLastIndex((match) => match.historyIndex <= anchor)
      : matches.findIndex((match) => match.historyIndex >= anchor)
  if (index >= 0) return index
  if (loop && matches.length) return direction === -1 ? matches.length - 1 : 0
  return direction === -1 ? -1 : matches.length
}

export function cycleComposerHistoryMatch(
  index: number,
  count: number,
  direction: -1 | 1,
  loop: boolean,
): number {
  if (!count) return -1
  const next = index + direction
  return loop ? ((next % count) + count) % count : Math.max(-1, Math.min(count, next))
}

/** Finish only the submitted snapshot; edits made during async preparation stay intact. */
export function completeComposerSend(
  state: ComposerState,
  input: string,
  options: { keepInput: boolean; remember: boolean },
): ComposerState {
  const history = options.remember ? rememberComposerMessage(state, input).history : state.history
  if (options.keepInput || state.text !== input) return { ...state, history }
  return { ...state, text: '', history, historyIndex: null, savedDraft: null }
}

export function composerTranslationMode(
  state: Pick<ComposerState, 'translateOnSend'>,
  configured: 'off' | 'preview' | 'send',
): 'off' | 'preview' | 'send' {
  if (state.translateOnSend === false) return 'off'
  return state.translateOnSend === true && configured === 'off' ? 'send' : configured
}

declare module './persistent-resources' {
  interface PersistentResources {
    composers: Store<Map<string, ComposerState>>
    autoTranslationLanguages: Store<ReadonlyMap<string, string>>
  }
}
