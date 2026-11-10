export interface MentionSuggestion {
  type: 'mention'
  label: string
  insertLabel: string
  color: string | null
  description?: string
  platform: string
  platformUserId: string
  displayName: string
  username?: string
  avatarUrl?: string
  currentAlias?: string
}

export interface EmoteSuggestion {
  type: 'emote'
  label: string
  imageUrl: string
  animated: boolean
  emoji?: string
}

export type BotCommandSource = 'twir' | 'jeetbot' | 'fossabot' | 'nightbot'

export interface CommandSuggestion {
  type: 'command'
  label: string
  insertText: string
  description: string
  /** The chat bot that answers this `!command`; absent for TwirChat's own `/commands`. */
  source?: BotCommandSource
}

/** A value for the bot-command argument being typed; it replaces the word under the cursor. */
export interface ArgumentSuggestion {
  type: 'argument'
  label: string
  insertText: string
  description: string
}

export type AutocompleteSuggestion =
  | MentionSuggestion
  | EmoteSuggestion
  | CommandSuggestion
  | ArgumentSuggestion

export interface ParsedToken {
  mode: 'mention' | 'emote' | 'command' | 'bot-command' | 'bot-argument' | null
  query: string
}

export function parseToken(text: string): ParsedToken {
  const trimmedStart = text.trimStart()

  if (trimmedStart.startsWith('/') && !trimmedStart.includes(' ')) {
    return { mode: 'command', query: trimmedStart.slice(1) }
  }
  if (trimmedStart.startsWith('!') && !/\s/u.test(trimmedStart)) {
    return { mode: 'bot-command', query: trimmedStart.slice(1).toLowerCase() }
  }

  const words = text.split(/\s+/)
  const lastWord = words[words.length - 1] ?? ''

  if (lastWord.startsWith('@') && lastWord.length >= 2) {
    return { mode: 'mention', query: lastWord.slice(1) }
  }

  if (lastWord.startsWith(':') && lastWord.length >= 2) {
    return { mode: 'emote', query: lastWord.slice(1) }
  }

  return { mode: null, query: '' }
}

/** Twir matches keep their order; a jeetbot command of the same name follows its Twir twin. */
export function mergeBotCommandMatches(
  twir: readonly CommandSuggestion[],
  jeetbot: readonly CommandSuggestion[],
): CommandSuggestion[] {
  if (!jeetbot.length) return [...twir]
  const rest = new Map(jeetbot.map((suggestion) => [suggestion.label.toLowerCase(), suggestion]))
  const merged: CommandSuggestion[] = []
  for (const suggestion of twir) {
    merged.push(suggestion)
    const key = suggestion.label.toLowerCase()
    const twin = rest.get(key)
    if (twin) {
      merged.push(twin)
      rest.delete(key)
    }
  }
  return [...merged, ...rest.values()]
}

export function replaceToken(text: string, suggestion: AutocompleteSuggestion): string {
  if (suggestion.type === 'command') {
    const commandMatch = text.match(/^\s*\/\S*$/)
    if (!commandMatch) {
      return text
    }

    const leadingWhitespace = commandMatch[0].match(/^\s*/)?.[0] ?? ''
    return `${leadingWhitespace}${suggestion.insertText} `
  }

  if (suggestion.type === 'argument') return text.replace(/\S*$/u, `${suggestion.insertText} `)

  const mentionMatch = suggestion.type === 'mention' ? text.match(/(@\S*)$/) : null
  const emoteMatch = suggestion.type === 'emote' ? text.match(/(:\S*)$/) : null
  const match = mentionMatch ?? emoteMatch

  if (!match || match.index === undefined) {
    return text
  }

  const before = text.slice(0, match.index)

  if (suggestion.type === 'mention') {
    return `${before}@${suggestion.insertLabel} `
  }

  return `${before}${suggestion.emoji ?? suggestion.label} `
}
