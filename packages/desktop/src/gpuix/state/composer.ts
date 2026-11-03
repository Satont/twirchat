import type { Store } from './create-store'
import { createStore } from './create-store'
import { persistentResource } from './persistent-resources'

export interface ComposerState {
  text: string
  history: string[]
  historyIndex: number | null
  savedDraft: string | null
  translateOnSend?: boolean
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

export function editComposer(state: ComposerState, text: string): ComposerState {
  return { ...state, text, historyIndex: null }
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

type LocalCommandName = 'clearmessages' | 'copy' | 'pause' | 'resume' | 'mentions' | 'search'

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
  }
}
