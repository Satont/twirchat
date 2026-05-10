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
}

export interface CommandSuggestion {
  type: 'command'
  label: string
  insertText: string
  description: string
}

export type AutocompleteSuggestion = MentionSuggestion | EmoteSuggestion | CommandSuggestion

export interface ParsedToken {
  mode: 'mention' | 'emote' | 'command' | null
  query: string
}

export function parseToken(text: string): ParsedToken {
  const trimmedStart = text.trimStart()

  if (trimmedStart.startsWith('/') && !trimmedStart.includes(' ')) {
    return { mode: 'command', query: trimmedStart.slice(1) }
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

export function replaceToken(text: string, suggestion: AutocompleteSuggestion): string {
  if (suggestion.type === 'command') {
    const commandMatch = text.match(/^\s*\/\S*$/)
    if (!commandMatch) {
      return text
    }

    const leadingWhitespace = commandMatch[0].match(/^\s*/)?.[0] ?? ''
    return `${leadingWhitespace}${suggestion.insertText} `
  }

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

  return `${before}${suggestion.label} `
}
