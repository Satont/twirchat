import type { KeyEvent } from '@gpuix/react'
import { z } from 'zod'

import { t } from './i18n'

function defineHotkeyActions<const Actions extends Record<string, readonly string[]>>(
  actions: Actions,
): Actions {
  return actions
}
export const HOTKEY_ACTIONS = defineHotkeyActions({
  window: [
    'newSplit',
    'newTab',
    'openSettings',
    'openAccountSelector',
    'openQuickSwitcher',
    'quit',
    'removeTab',
    'reopenSplit',
    'selectTabHistoryBack',
    'selectTabHistoryForward',
    'toggleLocalR9K',
    'openFollowedChannels',
    'moveTab',
    'openTab',
    'popup',
    'setStreamerMode',
    'zoom',
    'setTabVisibility',
  ],
  split: [
    'changeChannel',
    'clearMessages',
    'createClip',
    'delete',
    'openInBrowser',
    'openPlayerInBrowser',
    'openInCustomPlayer',
    'openInStreamlink',
    'openModView',
    'openUnbanRequests',
    'openRewardQueue',
    'openViewerList',
    'pickFilters',
    'reconnect',
    'scrollToBottom',
    'scrollToTop',
    'showSearch',
    'showGlobalSearch',
    'debug',
    'popupOverlay',
    'openSubscriptionPage',
    'focus',
    'reloadEmotes',
    'runCommand',
    'scrollPage',
    'setChannelNotification',
    'setModerationMode',
    'toggleOverlayInertia',
    'setHighlightSounds',
    'changeMultichannelContext',
  ],
  splitInput: [
    'clear',
    'nextMessage',
    'openEmotesPopup',
    'paste',
    'previousMessage',
    'redo',
    'selectAll',
    'selectWord',
    'toggleTranslateOnSend',
    'undo',
    'cancelReply',
    'copy',
    'cursorToStart',
    'cursorToEnd',
    'sendMessage',
    'incremental-search-history',
  ],
  popupWindow: [
    'reject',
    'accept',
    'delete',
    'search',
    'openProfilePictureMenu',
    'pin',
    'openTab',
    'scrollPage',
    'execModeratorAction',
  ],
})
export type HotkeyCategory = keyof typeof HOTKEY_ACTIONS
export type HotkeyAction = (typeof HOTKEY_ACTIONS)[HotkeyCategory][number]
export interface HotkeyBinding {
  id: string
  name: string
  enabled: boolean
  category: HotkeyCategory
  action: HotkeyAction
  keys: string[]
  arguments: string[]
}

const aliases: Record<string, string> = {
  control: 'ctrl',
  command: 'cmd',
  meta: 'cmd',
  super: 'cmd',
  option: 'alt',
  return: 'enter',
  numpadenter: 'enter',
  'numpad-enter': 'enter',
  esc: 'escape',
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  arrowdown: 'down',
  pgup: 'pageup',
  pgdown: 'pagedown',
  spacebar: 'space',
  '+': 'plus',
}
const modifiers: readonly string[] = ['ctrl', 'cmd', 'alt', 'shift']

export function parseHotkeyChoice<const Choices extends readonly string[]>(
  value: string | undefined,
  choices: Choices,
): Choices[number] {
  const match = choices.find((choice) => choice === value)
  if (match === undefined)
    throw new Error(
      t('commands.hotkey.invalidArgument', {
        value: value ?? t('commands.hotkey.missingArgument'),
      }),
    )
  return match
}

export function normalizeKeyChord(value: string): string {
  let input = value.trim().toLowerCase()
  if (input === '+') input = 'plus'
  else if (input.endsWith('++')) input = `${input.slice(0, -1)}plus`
  const parts = input.split('+').map((part) => aliases[part.trim()] ?? part.trim())
  const keys = parts.filter((part) => !modifiers.includes(part))
  if (
    keys.length !== 1 ||
    !keys[0] ||
    /[\s\r\n]/u.test(keys[0]) ||
    new Set(parts).size !== parts.length
  )
    throw new Error(t('commands.hotkey.oneKey'))
  return [...modifiers.filter((modifier) => parts.includes(modifier)), keys[0]].join('+')
}

export function eventKeyChord(event: Pick<KeyEvent, 'key' | 'modifiers'>): string | null {
  const key = event.key === ' ' ? 'space' : event.key?.toLowerCase()
  if (
    !key ||
    modifiers.includes(key) ||
    ['control', 'command', 'meta', 'super', 'option'].includes(key)
  )
    return null
  try {
    return normalizeKeyChord(
      [
        ...(event.modifiers?.ctrl ? ['ctrl'] : []),
        ...(event.modifiers?.cmd ? ['cmd'] : []),
        ...(event.modifiers?.alt ? ['alt'] : []),
        ...(event.modifiers?.shift ? ['shift'] : []),
        key === '+' ? 'plus' : key,
      ].join('+'),
    )
  } catch {
    return null
  }
}

/** Chatterino arguments are separate lines; spaces inside one argument are preserved. */
export function parseHotkeyArguments(value: string): string[] {
  const trimmed = value.trim()
  return trimmed === '' ? [] : trimmed.split('\n').map((argument) => argument.trim())
}
const toggle = ['on', 'off', 'toggle']
const argsSpec: Record<string, { min: number; max: number; choices?: string[][]; index?: 0 | 1 }> =
  {
    'window.moveTab': { min: 1, max: 1, choices: [['next', 'previous']], index: 0 },
    'window.openTab': { min: 1, max: 1, choices: [['last', 'next', 'previous']], index: 0 },
    'window.popup': { min: 1, max: 1, choices: [['split', 'window']] },
    'window.setStreamerMode': { min: 0, max: 1, choices: [[...toggle, 'auto']] },
    'window.zoom': { min: 1, max: 1, choices: [['in', 'out', 'reset']] },
    'window.setTabVisibility': { min: 0, max: 1, choices: [[...toggle, 'liveOnly']] },
    'split.focus': { min: 1, max: 1, choices: [['up', 'above', 'down', 'below', 'left', 'right']] },
    'split.reloadEmotes': { min: 0, max: 1, choices: [['channel', 'subscriber']] },
    'split.runCommand': { min: 1, max: 1 },
    'split.scrollPage': { min: 1, max: 1, choices: [['up', 'down']] },
    'split.setChannelNotification': { min: 0, max: 1, choices: [toggle] },
    'split.setModerationMode': { min: 0, max: 1, choices: [toggle] },
    'split.toggleOverlayInertia': { min: 1, max: 1, choices: [['this', 'thisOrAll', 'all']] },
    'split.setHighlightSounds': { min: 0, max: 1, choices: [toggle] },
    'split.changeMultichannelContext': { min: 1, max: 1, choices: [['next', 'prev']], index: 0 },
    'splitInput.copy': { min: 1, max: 1, choices: [['auto', 'split', 'splitInput']] },
    'splitInput.cursorToStart': {
      min: 1,
      max: 1,
      choices: [['withSelection', 'withoutSelection']],
    },
    'splitInput.cursorToEnd': { min: 1, max: 1, choices: [['withSelection', 'withoutSelection']] },
    'splitInput.sendMessage': { min: 0, max: 1, choices: [['keepInput']] },
    'splitInput.incremental-search-history': {
      min: 2,
      max: 2,
      choices: [
        ['forward', 'backward'],
        ['loop', 'noloop'],
      ],
    },
    'popupWindow.openTab': { min: 1, max: 1, choices: [['last', 'next', 'previous']], index: 0 },
    'popupWindow.scrollPage': { min: 1, max: 1, choices: [['up', 'down']] },
    'popupWindow.execModeratorAction': { min: 1, max: 1, choices: [['ban', 'unban']], index: 1 },
  }

export function validateHotkeyArguments(
  category: HotkeyCategory,
  action: HotkeyAction,
  args: string[],
): void {
  if (!HOTKEY_ACTIONS[category].some((candidate) => candidate === action))
    throw new Error(t('commands.hotkey.unknownAction'))
  const spec = argsSpec[`${category}.${action}`] ?? { min: 0, max: 0 }
  if (
    args.length < spec.min ||
    args.length > spec.max ||
    args.some((argument) => typeof argument !== 'string' || argument.length > 4096)
  )
    throw new Error(
      t('commands.hotkey.expectsArguments', {
        action,
        count: spec.min === spec.max ? spec.min : `${spec.min}–${spec.max}`,
      }),
    )
  args.forEach((argument, index) => {
    if (!argument.trim() || /[\r\n]/u.test(argument))
      throw new Error(t('commands.hotkey.nonemptyLine'))
    const choices = spec.choices?.[index]
    const numeric =
      index === 0 &&
      spec.index !== undefined &&
      /^(0|[1-9]\d{0,5})$/u.test(argument) &&
      Number(argument) >= spec.index
    if (choices && !choices.includes(argument) && !numeric)
      throw new Error(
        t('commands.hotkey.chooseArgument', {
          index: index + 1,
          choices: choices.join(', '),
          extra:
            spec.index !== undefined && index === 0
              ? t('commands.hotkey.chooseIndex', { index: spec.index })
              : '',
        }),
      )
  })
}

const shortcutInput = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  category: z.string(),
  action: z.string(),
  arguments: z.array(z.string()),
  keys: z.array(z.string()),
})
const hotkeyConfigurationInput = z.object({ bindings: z.unknown(), legacyNavigation: z.boolean() })
export function isHotkeyCategory(value: string): value is HotkeyCategory {
  return Object.hasOwn(HOTKEY_ACTIONS, value)
}
export function isHotkeyAction(value: string): value is HotkeyAction {
  return Object.values(HOTKEY_ACTIONS).some((actions) => actions.some((action) => action === value))
}

export function validateHotkeyBindings(value: unknown): HotkeyBinding[] {
  if (!Array.isArray(value) || value.length > 512) throw new Error(t('commands.hotkey.tooMany'))
  const ids = new Set<string>()
  const bindings = value.map((item: unknown): HotkeyBinding => {
    const decoded = shortcutInput.safeParse(item)
    if (!decoded.success) throw new Error(t('commands.hotkey.invalidShortcut'))
    const input = decoded.data
    if (typeof input.id !== 'string' || !input.id || input.id.length > 128 || ids.has(input.id))
      throw new Error(t('commands.hotkey.uniqueIds'))
    ids.add(input.id)
    if (
      typeof input.name !== 'string' ||
      input.name.length > 100 ||
      typeof input.enabled !== 'boolean' ||
      !isHotkeyCategory(input.category) ||
      !isHotkeyAction(input.action) ||
      !Array.isArray(input.arguments) ||
      !Array.isArray(input.keys) ||
      input.keys.some((key) => typeof key !== 'string' || key.length > 128)
    )
      throw new Error(t('commands.hotkey.invalidShortcut'))
    if (!input.keys.length) throw new Error(t('commands.hotkey.atLeastOneKey'))
    if (input.keys.length > 4) throw new Error(t('commands.hotkey.maxFourChords'))
    const category = input.category
    const action = input.action
    const args = input.arguments
    validateHotkeyArguments(category, action, args)
    return {
      id: input.id,
      name: input.name.trim(),
      enabled: input.enabled,
      category,
      action,
      arguments: [...args],
      keys: input.keys.map(normalizeKeyChord),
    }
  })
  for (let index = 0; index < bindings.length; index++) {
    const binding = bindings[index]!
    if (!binding.enabled) continue
    for (const other of bindings.slice(index + 1)) {
      if (!other.enabled || other.category !== binding.category) continue
      const length = Math.min(binding.keys.length, other.keys.length)
      if (binding.keys.slice(0, length).every((key, part) => key === other.keys[part]))
        throw new Error(
          t('commands.hotkey.conflict', {
            name: binding.name || binding.action,
            other: other.name || other.action,
            category: binding.category,
          }),
        )
    }
  }
  return bindings
}

export type HotkeyHandler = (args: readonly string[]) => void | Promise<unknown>
export interface HotkeyContext {
  windowId: string
  id: string
  category: HotkeyCategory
  handlers: Partial<Record<HotkeyAction, HotkeyHandler | null>>
}

/** Routes are explicit, from focused editor/popup to its split and owning window. */
export function createHotkeyDispatcher(options: {
  bindings: () => readonly HotkeyBinding[]
  now?: () => number
  sequenceTimeoutMs?: number
  onError?: (error: unknown) => void
}) {
  const contexts = new Map<string, HotkeyContext>()
  const pending = new Map<string, { context: HotkeyContext; keys: string[]; at: number }>()
  const now = options.now ?? Date.now
  const keyOf = (windowId: string, id: string) => JSON.stringify([windowId, id])
  return {
    register(context: HotkeyContext): () => void {
      const key = keyOf(context.windowId, context.id)
      contexts.set(key, context)
      return () => {
        if (contexts.get(key) === context) contexts.delete(key)
        if (pending.get(context.windowId)?.context === context) pending.delete(context.windowId)
      }
    },
    cancel(windowId: string): void {
      pending.delete(windowId)
    },
    handle(event: KeyEvent, windowId: string, route: readonly string[]): boolean {
      const chord = eventKeyChord(event)
      if (!chord || event.defaultPrevented) return false
      const old = pending.get(windowId)
      pending.delete(windowId)
      const previous =
        old &&
        route.includes(old.context.id) &&
        contexts.get(keyOf(windowId, old.context.id)) === old.context &&
        now() - old.at <= (options.sequenceTimeoutMs ?? 1000)
          ? old
          : undefined
      const attempts = previous ? [previous.keys.concat(chord), [chord]] : [[chord]]
      for (const sequence of attempts) {
        for (const id of route) {
          const context = contexts.get(keyOf(windowId, id))
          if (!context || (sequence.length > 1 && context !== previous?.context)) continue
          const matches = options
            .bindings()
            .filter(
              (binding) =>
                binding.enabled &&
                binding.category === context.category &&
                !!context.handlers[binding.action] &&
                sequence.length <= binding.keys.length &&
                sequence.every((key, index) => binding.keys[index] === key),
            )
          if (!matches.length) continue
          event.preventDefault()
          event.stopPropagation()
          const exact = matches.find((binding) => binding.keys.length === sequence.length)
          if (!exact) {
            pending.set(windowId, { context, keys: sequence, at: now() })
            return true
          }
          try {
            Promise.resolve(context.handlers[exact.action]!(exact.arguments)).catch((error) =>
              options.onError?.(error),
            )
          } catch (error) {
            options.onError?.(error)
          }
          return true
        }
      }
      return false
    },
  }
}

export interface HotkeyConfiguration {
  bindings: HotkeyBinding[]
  legacyNavigation: boolean
}
export function validateHotkeyConfiguration(value: unknown): HotkeyConfiguration {
  const input = hotkeyConfigurationInput.parse(value)
  return {
    bindings: validateHotkeyBindings(input.bindings),
    legacyNavigation: input.legacyNavigation,
  }
}

/** Recorder shares the same normalization as dispatch; Escape cancels, Enter is a real key. */
export function recordHotkeyStroke(
  keys: readonly string[],
  event: Pick<KeyEvent, 'key' | 'modifiers'>,
): { keys: string[]; cancelled: boolean; complete: boolean } | null {
  const chord = eventKeyChord(event)
  if (!chord) return null
  if (chord === 'escape') return { keys: [...keys], cancelled: true, complete: false }
  const next = [...keys, chord].slice(0, 4)
  return { keys: next, cancelled: false, complete: next.length === 4 }
}
