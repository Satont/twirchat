import { afterEach, describe, expect, test } from 'bun:test'
import { renderMessageText } from '../src/views/shared/utils/message-text'

const mentionColors = new Map<string, string | null>()

afterEach(() => {
  mentionColors.clear()
})

describe('renderMessageText', () => {
  test('does not parse a username in a URL as a mention inside link attributes', () => {
    const url = 'https://www.tiktok.com/@ooomarcinek/video/7661334965514161430'
    mentionColors.set('twitch:ooomarcinek', '#9147ff')

    expect(renderMessageText(url, 'twitch', mentionColors)).toBe(
      `<a class="msg-link" href="#" data-href="${url}" title="${url}">${url}</a>`,
    )
  })

  test('formats a standalone mention with its cached color', () => {
    mentionColors.set('twitch:pilotgamer', '#9147ff')

    expect(renderMessageText('Hello @pilotgamer', 'twitch', mentionColors)).toBe(
      'Hello <span class="mention" style="color: #9147ff; font-weight: 600;">@pilotgamer</span>',
    )
  })
})
