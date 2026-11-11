import type { KeyEvent } from '@gpuix/react'

export function handleActivation(event: KeyEvent, callback: () => void) {
  if (event.key !== 'enter' && event.key !== 'space') return
  event.preventDefault()
  callback()
}
