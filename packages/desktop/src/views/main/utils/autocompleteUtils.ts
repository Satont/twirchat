export interface MentionSuggestion {
  type: 'mention'
  label: string
  color: string | null
}

export interface EmoteSuggestion {
  type: 'emote'
  label: string
  imageUrl: string
  animated: boolean
}

export type AutocompleteSuggestion = MentionSuggestion | EmoteSuggestion

export interface ParsedToken {
  mode: 'mention' | 'emote' | null
  query: string
}

export function parseToken(text: string): ParsedToken {
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
  const mentionMatch = suggestion.type === 'mention' ? text.match(/(@\S*)$/) : null
  const emoteMatch = suggestion.type === 'emote' ? text.match(/(:\S*)$/) : null
  const match = mentionMatch ?? emoteMatch

  if (!match || match.index === undefined) {
    return text
  }

  const before = text.slice(0, match.index)

  if (suggestion.type === 'mention') {
    return `${before}@${suggestion.label} `
  }

  return `${before}${suggestion.label} `
}
