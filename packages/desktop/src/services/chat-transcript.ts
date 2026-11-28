import type { NormalizedChatMessage } from '@twirchat/shared/types'

type TranscriptMessage = Pick<NormalizedChatMessage, 'author' | 'text'> & {
  platform: string
  timestamp: Date | number
}

export function formatChatTranscript(messages: readonly TranscriptMessage[]): string {
  return messages
    .map((message) => {
      const date = new Date(message.timestamp)
      const time = Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleTimeString([], { hour12: false })
      return `[${time}] [${message.platform}] ${message.author.displayName}: ${message.text}`
    })
    .join('\n')
}
