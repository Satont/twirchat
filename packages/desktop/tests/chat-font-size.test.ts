import { beforeEach, expect, test } from 'bun:test'

import { DEFAULT_SETTINGS } from '@twirchat/shared/types'

import { settingsStore } from '../src/gpuix/state/app'
import {
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  CHAT_FONT_SIZE_SAVE_DELAY_MS,
  clampChatFontSize,
  stepChatFontSize,
  type ChatFontSizeApi,
} from '../src/gpuix/state/chat-font-size'

function installSettings(fontSize = 14): void {
  settingsStore.set({ ...DEFAULT_SETTINGS, fontSize })
}

function recordingApi(saved: number[]): ChatFontSizeApi {
  return {
    saveSettings: async (settings) => {
      saved.push(settings.fontSize)
    },
  }
}

beforeEach(() => {
  installSettings()
})

test('clamps the shared chat font bounds', () => {
  expect(clampChatFontSize(CHAT_FONT_SIZE_MIN - 5)).toBe(CHAT_FONT_SIZE_MIN)
  expect(clampChatFontSize(CHAT_FONT_SIZE_MAX + 5)).toBe(CHAT_FONT_SIZE_MAX)
  expect(clampChatFontSize(14.4)).toBe(14)
  expect(clampChatFontSize(14.6)).toBe(15)
  expect(clampChatFontSize(Number.NaN)).toBe(CHAT_FONT_SIZE_MIN)
  expect(clampChatFontSize(Number.POSITIVE_INFINITY)).toBe(CHAT_FONT_SIZE_MIN)
})

test('a wheel step moves one pixel per direction', () => {
  const saved: number[] = []
  installSettings(14)
  expect(stepChatFontSize(recordingApi(saved), 1)).toBe(15)
  expect(settingsStore.get()?.fontSize).toBe(15)
  expect(stepChatFontSize(recordingApi(saved), -1)).toBe(14)
  expect(settingsStore.get()?.fontSize).toBe(14)
})

test('a wheel step stops on the bounds and does not schedule a write', async () => {
  const saved: number[] = []
  installSettings(CHAT_FONT_SIZE_MAX)
  expect(stepChatFontSize(recordingApi(saved), 1)).toBeNull()
  installSettings(CHAT_FONT_SIZE_MIN)
  expect(stepChatFontSize(recordingApi(saved), -1)).toBeNull()
  await Bun.sleep(CHAT_FONT_SIZE_SAVE_DELAY_MS + 80)
  expect(saved).toEqual([])
})

test('a gesture writes once with the settings current at flush time', async () => {
  const saved: number[] = []
  const api = recordingApi(saved)
  installSettings(14)
  stepChatFontSize(api, 1)
  stepChatFontSize(api, 1)
  expect(saved).toEqual([])
  // Another preference changed during the gesture must survive the write.
  const current = settingsStore.get()
  if (!current) throw new Error('Settings are not loaded.')
  settingsStore.set({ ...current, showAvatars: false })
  await Bun.sleep(CHAT_FONT_SIZE_SAVE_DELAY_MS + 80)
  expect(saved).toEqual([16])
  expect(settingsStore.get()?.showAvatars).toBe(false)
})
