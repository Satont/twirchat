import { t } from '../gpuix/i18n'

export interface PrivateCommand {
  text: string
  recipient: string
}
/** Resolve private shorthand before custom commands or any public-chat dispatch. */
export function normalizePrivateCommand(
  input: string,
  lastRecipient: string | null,
): PrivateCommand | null {
  const text = input.trim()
  let recipient: string
  let body: string
  const whisper = text.match(/^(?:\/w|\/whisper|\.w)(?:\s+([\s\S]*))?$/iu)
  const reply = text.match(/^\/r(?:\s+([\s\S]*))?$/iu)
  const supi = text.match(/^\/\$(?:\s+)?([\s\S]*)$/u)
  const utility = text.match(/^\/_(?:\s+)?([\s\S]*)$/u)
  if (whisper) {
    const words = (whisper[1] ?? '').match(/^@?(\S+)\s+([\s\S]+)$/u)
    if (!words) throw new Error(t('notices.privateCommands.whisperUsage'))
    recipient = words[1] ?? ''
    body = words[2] ?? ''.trim()
  } else if (reply) {
    body = reply[1]?.trim() ?? ''
    if (!body) throw new Error(t('notices.privateCommands.replyUsage'))
    if (!lastRecipient) throw new Error(t('notices.privateCommands.noRecipient'))
    recipient = lastRecipient
  } else if (supi || utility) {
    const argument = (supi?.[1] ?? utility?.[1] ?? '').trim()
    if (!argument)
      throw new Error(t('notices.privateCommands.botUsage', { command: supi ? '$' : '_' }))
    recipient = supi ? 'supibot' : 'mm_sutilitybot'
    body = `${supi ? '$' : '_'}${argument}`
  } else return null
  if (!/^[a-z0-9_]{1,25}$/iu.test(recipient))
    throw new Error(t('notices.privateCommands.invalidRecipient'))
  if (!body) throw new Error(t('notices.privateCommands.emptyMessage'))
  return { text: `/w ${recipient} ${body}`, recipient }
}
