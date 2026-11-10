import { expect, test } from 'bun:test'

import type { DesktopEventMap } from '../src/gpuix/backend/events'
import {
  dismissUpdateToast,
  initialUpdateToastState,
  nextUpdateToastState,
  type UpdateToastState,
} from '../src/gpuix/update-toast-state'

const apply = (statuses: DesktopEventMap['update_status'][], start = initialUpdateToastState) =>
  statuses.reduce<UpdateToastState>(nextUpdateToastState, start)

const visible = (state: UpdateToastState) => state.update !== null && state.dismissed === null

test('a closed toast stays hidden through download progress and completion', () => {
  const closed = dismissUpdateToast(
    apply([{ status: 'downloading', message: '', progress: 10, hash: 'a' }]),
  )
  const next = apply(
    [
      { status: 'downloading', message: '', progress: 60, hash: 'a' },
      { status: 'download-complete', message: '', hash: 'a' },
    ],
    closed,
  )
  expect(visible(next)).toBe(false)
  expect(next.update?.status).toBe('download-complete')
})

test('a closed toast stays hidden after a background download error', () => {
  const closed = dismissUpdateToast(apply([{ status: 'update-available', message: '', hash: 'a' }]))
  expect(visible(apply([{ status: 'update-error', message: '' }], closed))).toBe(false)
})

test('a manual check or another release shows the toast again', () => {
  const closed = dismissUpdateToast(
    apply([{ status: 'download-complete', message: '', hash: 'a' }]),
  )
  expect(visible(apply([{ status: 'checking', message: '' }], closed))).toBe(true)
  expect(visible(apply([{ status: 'update-available', message: '', hash: 'b' }], closed))).toBe(
    true,
  )
})

test('idle clears the toast and its dismissal', () => {
  const closed = dismissUpdateToast(
    apply([{ status: 'download-complete', message: '', hash: 'a' }]),
  )
  expect(apply([{ status: 'idle', message: '' }], closed)).toEqual(initialUpdateToastState)
})
