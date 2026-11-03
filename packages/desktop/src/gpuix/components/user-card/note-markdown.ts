export interface NoteInline {
  text: string
  style?: 'strong' | 'emphasis' | 'code' | 'link'
  url?: string
}
export interface NoteLine {
  kind: 'paragraph' | 'heading' | 'quote' | 'list' | 'code'
  level?: number
  content: NoteInline[]
}

/** Limited, safe Markdown for native views: HTML is always literal text. */
export function parseNoteInline(source: string): NoteInline[] {
  const result: NoteInline[] = []
  const pattern =
    /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g
  let position = 0
  for (const match of source.matchAll(pattern)) {
    if (match.index > position) result.push({ text: source.slice(position, match.index) })
    if (match[1]) result.push({ text: match[1], style: 'strong' })
    else if (match[2]) result.push({ text: match[2], style: 'emphasis' })
    else if (match[3]) result.push({ text: match[3], style: 'code' })
    else result.push({ text: match[4]!, style: 'link', url: match[5] })
    position = match.index + match[0].length
  }
  if (position < source.length) result.push({ text: source.slice(position) })
  return result.length ? result : [{ text: ' ' }]
}
export function parseNoteMarkdown(source: string): NoteLine[] {
  let code = false
  return source.split('\n').flatMap((line): NoteLine[] => {
    if (line.startsWith('```')) {
      code = !code
      return []
    }
    if (code) return [{ kind: 'code', content: [{ text: line || ' ' }] }]
    const heading = line.match(/^(#{1,6})\s+(.*)/)
    if (heading)
      return [{ kind: 'heading', level: heading[1]!.length, content: parseNoteInline(heading[2]!) }]
    if (line.startsWith('> ')) return [{ kind: 'quote', content: parseNoteInline(line.slice(2)) }]
    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line))
      return [
        { kind: 'list', content: parseNoteInline(line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '• ')) },
      ]
    return [{ kind: 'paragraph', content: parseNoteInline(line) }]
  })
}
