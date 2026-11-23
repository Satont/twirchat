export type NoteFormat = 'bold' | 'strike' | 'list' | 'quote' | 'code'

interface Snippet {
  prefix: string
  suffix: string
  placeholder: string
  inline: boolean
}

const SNIPPETS: Record<NoteFormat, Snippet> = {
  bold: { prefix: '**', suffix: '**', placeholder: 'bold text', inline: true },
  strike: { prefix: '~~', suffix: '~~', placeholder: 'strikethrough text', inline: true },
  list: { prefix: '- ', suffix: '', placeholder: 'list item', inline: false },
  quote: { prefix: '> ', suffix: '', placeholder: 'quote', inline: false },
  code: { prefix: '`', suffix: '`', placeholder: 'code', inline: true },
}

/** Inserts a Markdown snippet into a note at the end of the current text. */
export function formatNote(text: string, format: NoteFormat): string {
  const { prefix, suffix, placeholder, inline } = SNIPPETS[format]
  const snippet = `${prefix}${placeholder}${suffix}`
  if (!text) return snippet
  if (inline) return `${text}${text.endsWith('\n') ? '' : ' '}${snippet}`
  return `${text}${text.endsWith('\n') ? '' : '\n'}${snippet}`
}
