import type {
  JeetbotArgument,
  JeetbotArgumentOption,
  JeetbotCommand,
  JeetbotSubcommand,
} from '../../../services/jeetbot-commands'

/** A `!command` followed by whitespace: the arguments typed so far and the word being typed. */
export interface BotInvocation {
  name: string
  words: readonly string[]
  partial: string
}

export type BotArgumentPosition =
  | { kind: 'subcommand'; command: JeetbotCommand; name: string }
  | {
      kind: 'argument'
      command: JeetbotCommand
      name: string
      subcommand?: JeetbotSubcommand
      args: readonly JeetbotArgument[]
      index: number
    }

export interface SignaturePart {
  text: string
  active: boolean
}

// A trailing argument of these kinds takes the rest of the line, spaces included.
const REST_OF_LINE_TYPES = new Set(['text', 'string'])

export function parseBotInvocation(text: string): BotInvocation | null {
  const match = text.trimStart().match(/^!(\S+)\s+([\s\S]*)$/u)
  const name = match?.[1]
  const rest = match?.[2]
  if (name === undefined || rest === undefined) return null
  const words = rest.split(/\s+/u)
  const partial = words.pop() ?? ''
  return { name: name.toLowerCase(), words, partial }
}

export function findBotCommand(
  commands: readonly JeetbotCommand[],
  name: string,
): JeetbotCommand | undefined {
  return commands.find((command) => command.names.some((alias) => alias.toLowerCase() === name))
}

/**
 * The one name a command is suggested under for a typed prefix: its own prefix when it matches,
 * otherwise the first matching alias. Aliases still match, they just do not get rows of their own.
 */
export function suggestedCommandName(command: JeetbotCommand, query: string): string | undefined {
  const prefix = query.toLowerCase()
  const matches = (name: string) => name.toLowerCase().startsWith(prefix)
  const own = command.names.at(-1)
  return own !== undefined && matches(own) ? own : command.names.find(matches)
}

export function resolveArgumentPosition(
  command: JeetbotCommand,
  invocation: BotInvocation,
): BotArgumentPosition | null {
  const name = invocation.name
  let args = command.args
  let index = invocation.words.length
  let subcommand: JeetbotSubcommand | undefined
  if (command.subcommands.length) {
    const typed = invocation.words[0]?.toLowerCase()
    if (typed === undefined) return { kind: 'subcommand', command, name }
    subcommand = command.subcommands.find((candidate) => candidate.name.toLowerCase() === typed)
    if (!subcommand) return null
    args = subcommand.args
    index--
  }
  const last = args.at(-1)
  if (!last) return null
  if (index >= args.length) {
    if (!REST_OF_LINE_TYPES.has(last.type)) return null
    index = args.length - 1
  }
  return { kind: 'argument', command, name, subcommand, args, index }
}

export function currentArgument(position: BotArgumentPosition): JeetbotArgument | undefined {
  return position.kind === 'argument' ? position.args[position.index] : undefined
}

function argumentLabel(argument: JeetbotArgument): string {
  return argument.required ? `<${argument.name}>` : `[${argument.name}]`
}

/** `!name` plus its arguments, e.g. `<username> [seconds]`, for a command suggestion. */
export function argumentSummary(command: JeetbotCommand): string {
  if (command.subcommands.length)
    return `<${command.subcommands.map((subcommand) => subcommand.name).join('|')}>`
  return command.args.map(argumentLabel).join(' ')
}

export function argumentSignature(position: BotArgumentPosition): SignaturePart[] {
  const parts: SignaturePart[] = [{ text: `!${position.name}`, active: false }]
  if (position.kind === 'subcommand') {
    parts.push({ text: argumentSummary(position.command), active: true })
    return parts
  }
  if (position.subcommand) parts.push({ text: position.subcommand.name, active: false })
  position.args.forEach((argument, index) =>
    parts.push({ text: argumentLabel(argument), active: index === position.index }),
  )
  return parts
}

export function argumentHintText(position: BotArgumentPosition): string {
  if (position.kind === 'subcommand') return position.command.description
  const argument = currentArgument(position)
  if (!argument) return ''
  const examples = argument.examples.length ? ` (${argument.examples.join(', ')})` : ''
  return `${argument.description}${examples}`
}

function optionRank(option: JeetbotArgumentOption, query: string): number {
  const words = [option.value, option.label, ...option.aliases].map((word) => word.toLowerCase())
  if (words.some((word) => word.startsWith(query))) return 0
  if (words.some((word) => word.includes(query))) return 1
  return -1
}

/** Options whose value, label or alias matches the typed word; prefix matches first. */
export function matchArgumentOptions(
  options: readonly JeetbotArgumentOption[],
  partial: string,
): JeetbotArgumentOption[] {
  const query = partial.toLowerCase()
  if (!query) return [...options]
  return options
    .map((option) => ({ option, rank: optionRank(option, query) }))
    .filter(({ rank }) => rank >= 0)
    .toSorted((a, b) => a.rank - b.rank)
    .map(({ option }) => option)
}

export function matchSubcommands(
  subcommands: readonly JeetbotSubcommand[],
  partial: string,
): JeetbotSubcommand[] {
  const query = partial.toLowerCase()
  return subcommands.filter((subcommand) => subcommand.name.toLowerCase().startsWith(query))
}
