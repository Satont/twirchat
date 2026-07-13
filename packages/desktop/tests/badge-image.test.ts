import { expect, test } from 'bun:test'

import { resolveBadgeImage } from '../src/views/main/utils/badge-image'

test('resolves Kick embedded badge markers through the bundled SVG registry', () => {
  const image = resolveBadgeImage('embedded:kick:moderator')

  expect(image).toStartWith('<svg')
  expect(image).toContain('linearGradient')
})

test('preserves direct badge image URLs', () => {
  expect(resolveBadgeImage('https://cdn.example.test/badge.png')).toBe(
    'https://cdn.example.test/badge.png',
  )
})

test('does not render an unknown embedded Kick badge as a broken image', () => {
  expect(resolveBadgeImage('embedded:kick:subscriber')).toBeUndefined()
})
