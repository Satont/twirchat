import { describe, expect, test } from 'bun:test'

import { chatPausePreferences, chatPauseStore } from '../src/gpuix/state/chat-pause'
import {
  createPauseController,
  DEFAULT_CHAT_PAUSE_PREFERENCES,
  DOUBLE_CLICK_PAUSE_MS,
  hoverPauseDurationMs,
  matchesPauseModifier,
  normalizePauseModifier,
  PAUSE_MODIFIER_KEYS,
  validateChatPausePreferences,
  type ChatPauseReason,
} from '../src/services/chat-pause'
import { literal, required } from './fixture-values'

function fixture() {
  let clock = 0
  let nextId = 0
  const changes: boolean[] = []
  const timers = new Map<number, { at: number; callback: () => void }>()
  const controller = createPauseController({
    onChange: (paused) => changes.push(paused),
    now: () => clock,
    schedule: (callback, duration) => {
      const id = nextId++
      timers.set(id, { at: clock + duration, callback })
      return id
    },
    cancel: (id) => {
      timers.delete(id)
    },
  })
  return {
    controller,
    changes,
    timers,
    advance(milliseconds: number) {
      clock += milliseconds
      let remaining = 100
      while (true) {
        const ready = [...timers]
          .sort((a, b) => a[1].at - b[1].at)
          .find(([, timer]) => timer.at <= clock)
        if (!ready) return
        if (--remaining === 0) throw new Error('Timer did not converge')
        timers.delete(ready[0])
        ready[1].callback()
      }
    },
  }
}
const reasons = (controller: ReturnType<typeof createPauseController>): ChatPauseReason[] =>
  [...controller.reasons()].sort()

describe('independent chat pause deadlines', () => {
  test('expires a double-click pause without cancelling a longer mouse pause', () => {
    const { controller, changes, advance, timers } = fixture()
    controller.add('mouse', 1000)
    controller.add('doubleClick', DOUBLE_CLICK_PAUSE_MS)
    expect(changes).toEqual([true])
    expect(timers.size).toBe(1)
    advance(200)
    expect(reasons(controller)).toEqual(['mouse'])
    expect(controller.isPaused()).toBe(true)
    expect(changes).toEqual([true])
    advance(799)
    expect(controller.isPaused()).toBe(true)
    advance(1)
    expect(controller.isPaused()).toBe(false)
    expect(timers.size).toBe(0)
    expect(changes).toEqual([true, false])
  })
  test('keeps finite timers running beneath indefinite manual and search reasons', () => {
    const { controller, advance, changes, timers } = fixture()
    controller.add('manual')
    controller.add('search', null)
    controller.add('keyboardModifier')
    controller.add('mouse', 1000)
    controller.add('doubleClick', 200)
    advance(200)
    expect(reasons(controller)).toEqual(['keyboardModifier', 'manual', 'mouse', 'search'])
    expect(timers.size).toBe(1)
    advance(800)
    expect(reasons(controller)).toEqual(['keyboardModifier', 'manual', 'search'])
    expect(timers.size).toBe(0)
    controller.remove('keyboardModifier')
    controller.remove('manual')
    expect(controller.isPaused()).toBe(true)
    controller.remove('search')
    expect(changes).toEqual([true, false])
  })
  test('refreshes only the mouse deadline after every movement', () => {
    const { controller, advance, changes } = fixture()
    controller.add('mouse', 1000)
    advance(750)
    controller.add('mouse', 1000)
    controller.add('doubleClick', 200)
    advance(200)
    expect(reasons(controller)).toEqual(['mouse'])
    advance(50)
    expect(controller.isPaused()).toBe(true)
    advance(749)
    expect(controller.isPaused()).toBe(true)
    advance(1)
    expect(changes).toEqual([true, false])
  })
  test('leaving hover removes only the mouse reason', () => {
    const { controller, changes } = fixture()
    controller.add('mouse')
    controller.add('manual')
    controller.add('keyboardModifier')
    controller.remove('mouse')
    expect(reasons(controller)).toEqual(['keyboardModifier', 'manual'])
    controller.remove('manual')
    expect(changes).toEqual([true])
    controller.remove('keyboardModifier')
    expect(changes).toEqual([true, false])
  })
  test('deactivation releases keyboard and double-click but retains hover, manual and search', () => {
    const { controller, advance, changes, timers } = fixture()
    for (const reason of literal(['manual', 'search', 'keyboardModifier'])) controller.add(reason)
    controller.add('mouse', 1000)
    controller.add('doubleClick', 200)
    controller.deactivate()
    expect(reasons(controller)).toEqual(['manual', 'mouse', 'search'])
    expect(timers.size).toBe(1)
    advance(1000)
    expect(reasons(controller)).toEqual(['manual', 'search'])
    expect(changes).toEqual([true])
    controller.clear()
    expect(changes).toEqual([true, false])
  })
  test('deactivation resumes when only keyboard/double-click were active', () => {
    const { controller, changes, timers } = fixture()
    controller.add('keyboardModifier')
    controller.add('doubleClick', 200)
    controller.deactivate()
    expect(controller.isPaused()).toBe(false)
    expect(timers.size).toBe(0)
    expect(changes).toEqual([true, false])
  })
  test('zero and negative finite durations immediately release their own reason', () => {
    const { controller, changes } = fixture()
    controller.add('mouse')
    controller.add('manual')
    controller.add('mouse', 0)
    expect(reasons(controller)).toEqual(['manual'])
    controller.add('manual', -1)
    expect(changes).toEqual([true, false])
    expect(controller.isPaused()).toBe(false)
    expect(() => controller.add('mouse', Infinity)).toThrow('finite')
    expect(() => controller.add('mouse', NaN)).toThrow('finite')
  })
  test('an unchanged indefinite reason does not emit or allocate timers on mouse movement', () => {
    const { controller, changes, timers } = fixture()
    for (let index = 0; index < 1000; index++) controller.add('mouse')
    expect(changes).toEqual([true])
    expect(timers.size).toBe(0)
    controller.remove('mouse')
    controller.remove('mouse')
    expect(changes).toEqual([true, false])
  })
  test('dispose cancels pending work without emitting a synthetic resume or accepting new reasons', () => {
    const { controller, changes, timers, advance } = fixture()
    controller.add('mouse', 1000)
    const stale = required([...timers.values()][0]).callback
    controller.dispose()
    controller.dispose()
    stale()
    advance(1000)
    controller.add('manual')
    controller.clear()
    expect(controller.isPaused()).toBe(false)
    expect(reasons(controller)).toEqual([])
    expect(timers.size).toBe(0)
    expect(changes).toEqual([true])
  })
  test('cancelled timers cannot expire a refreshed reason even if an old callback runs', () => {
    const { controller, timers, advance } = fixture()
    controller.add('mouse', 100)
    const stale = required([...timers.values()][0]).callback
    advance(50)
    controller.add('mouse', 100)
    stale()
    advance(50)
    expect(controller.isPaused()).toBe(true)
    advance(50)
    expect(controller.isPaused()).toBe(false)
  })
  test('bounds scheduler delays while preserving a long finite deadline', () => {
    const { controller, timers, advance } = fixture()
    const maximum = 2_147_483_647
    controller.add('mouse', maximum + 1000)
    expect(required([...timers.values()][0]).at).toBe(maximum)
    advance(maximum)
    expect(controller.isPaused()).toBe(true)
    advance(1000)
    expect(controller.isPaused()).toBe(false)
  })
})

describe('chat pause settings and exact modifiers', () => {
  test('defaults disable all optional pause behavior and map hover duration correctly', () => {
    expect(DEFAULT_CHAT_PAUSE_PREFERENCES).toEqual({
      hoverSeconds: 0,
      modifier: 'none',
      doubleClickLinks: false,
    })
    expect(hoverPauseDurationMs(-1)).toBeNull()
    expect(hoverPauseDurationMs(0)).toBe(0)
    expect(hoverPauseDurationMs(1.5)).toBe(1500)
  })
  test('normalizes order while rejecting unknown or duplicate modifier keys', () => {
    expect(normalizePauseModifier(' SHIFT + CTRL ')).toBe('ctrl+shift')
    expect(normalizePauseModifier('cmd+alt+ctrl+shift')).toBe('ctrl+alt+shift+cmd')
    for (const invalid of ['', 'ctrl+ctrl', 'none+ctrl', 'control', 'ctrl+foo', 'ctrl+'])
      expect(() => normalizePauseModifier(invalid)).toThrow()
  })
  test('matches every nonempty modifier combination exactly; none never pauses', () => {
    expect(matchesPauseModifier('none', {})).toBe(false)
    expect(matchesPauseModifier('bad', { ctrl: true })).toBe(false)
    for (let bits = 1; bits < 16; bits++) {
      const keys = PAUSE_MODIFIER_KEYS.filter((_, index) => bits & (1 << index))
      const held = Object.fromEntries(keys.map((key) => [key, true]))
      expect(matchesPauseModifier(keys.join('+'), held)).toBe(true)
      const flip = PAUSE_MODIFIER_KEYS.find((key) => !keys.includes(key)) ?? required(keys[0])
      expect(matchesPauseModifier(keys.join('+'), { ...held, [flip]: !held[flip] })).toBe(false)
    }
  })
  test('validates finite durations and required preference fields without coercion', () => {
    for (const hoverSeconds of [-1, 0, 0.25, 300])
      expect(
        validateChatPausePreferences({
          hoverSeconds,
          modifier: 'shift+ctrl',
          doubleClickLinks: true,
        }),
      ).toEqual({ hoverSeconds, modifier: 'ctrl+shift', doubleClickLinks: true })
    for (const hoverSeconds of [-2, -0.5, 300.1, Infinity, NaN, '2'])
      expect(() =>
        validateChatPausePreferences({ hoverSeconds, modifier: 'none', doubleClickLinks: false }),
      ).toThrow()
    expect(() => validateChatPausePreferences({ hoverSeconds: 1, modifier: 'ctrl' })).toThrow()
    expect(() => validateChatPausePreferences(null)).toThrow()
  })
  test('retains failed preference writes for an explicit retry and serializes canonical settings', async () => {
    const previous = chatPauseStore.get()
    let fail = true
    const writes: { key: string; value: string }[] = []
    const api = {
      getUiState: async () => null,
      setUiState: async (write: { key: string; value: string }) => {
        writes.push(write)
        if (fail) throw new Error('QA storage unavailable')
      },
    }
    try {
      await expect(
        chatPausePreferences.save(api, {
          hoverSeconds: 2.5,
          modifier: 'shift+ctrl',
          doubleClickLinks: true,
        }),
      ).rejects.toThrow('storage unavailable')
      expect(chatPauseStore.get().error).toBe('QA storage unavailable')
      expect(chatPauseStore.get().value.modifier).toBe('ctrl+shift')
      expect(chatPauseStore.get().saving).toBe(false)
      fail = false
      await chatPausePreferences.save(api, chatPauseStore.get().value)
      expect(chatPauseStore.get().error).toBeNull()
      expect(writes).toHaveLength(2)
      expect(required(writes[1]).key).toBe('ui.chatPause')
      expect(JSON.parse(required(writes[1]).value)).toEqual({
        hoverSeconds: 2.5,
        modifier: 'ctrl+shift',
        doubleClickLinks: true,
      })
    } finally {
      chatPauseStore.set(previous)
    }
  })
})
