const URL_REGEX = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g
const MENTION_REGEX = /@([a-zA-Z0-9_]+)/g

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function linkifyText(escaped: string): string {
  return escaped.replace(URL_REGEX, (url) => {
    const safeUrl = url.replace(/"/g, '&quot;')
    return `<a class="msg-link" href="#" data-href="${safeUrl}" title="${safeUrl}">${url}</a>`
  })
}

function highlightMentions(
  html: string,
  platform: string,
  mentionColors: ReadonlyMap<string, string | null>,
): string {
  return html
    .split(/(<a\b[^>]*>.*?<\/a>|<[^>]*>)/g)
    .map((part) => {
      if (part.startsWith('<')) {
        return part
      }

      return part.replace(MENTION_REGEX, (match, username) => {
        const color = mentionColors.get(`${platform}:${username.toLowerCase()}`)
        return color
          ? `<span class="mention" style="color: ${color}; font-weight: 600;">${match}</span>`
          : match
      })
    })
    .join('')
}

export function renderMessageText(
  text: string,
  platform: string,
  mentionColors: ReadonlyMap<string, string | null>,
): string {
  return highlightMentions(linkifyText(escapeHtml(text)), platform, mentionColors)
}
