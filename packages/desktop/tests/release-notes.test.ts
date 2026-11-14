import { describe, expect, test } from 'bun:test'

import { formatReleaseDate, parseReleaseNotes } from '../src/gpuix/release-notes'

describe('parseReleaseNotes', () => {
  test('skips generated GitHub metadata and hidden contributor sections', () => {
    const notes = `GPUIX desktop release for Linux x64, Windows x64, and macOS Apple Silicon/Intel.

Source: \`8b8df667\`

Backend image: \`ghcr.io/satont/twirchat/backend@sha256:07a1\`

## What's Changed
* Make native scrollbars draggable by @infybtw in https://github.com/Satont/twirchat/pull/117

## New Contributors
* @infybtw made their first contribution in https://github.com/Satont/twirchat/pull/117

**Full Changelog**: https://github.com/Satont/twirchat/compare/v1.7.0...v1.7.1`

    expect(parseReleaseNotes(notes)).toEqual([
      {
        kind: 'new',
        items: [
          {
            label: 'Making native scrollbars draggable',
            description: 'Make native scrollbars draggable',
          },
        ],
      },
    ])
  })

  test('keeps plain notes together when there are no markdown sections', () => {
    expect(parseReleaseNotes('Fixed a crash\n- Item one\n1. Item two')).toEqual([
      { kind: 'fixed', items: [{ label: 'Fixing a crash', description: 'Fixed a crash' }] },
      {
        kind: 'other',
        items: [
          { label: 'Iteming one', description: 'Item one' },
          { label: 'Iteming two', description: 'Item two' },
        ],
      },
    ])
  })

  test('falls back to a placeholder for empty notes', () => {
    expect(parseReleaseNotes('   ')).toEqual([
      { kind: 'other', items: [{ label: '', description: 'No release notes available.' }] },
    ])
  })

  test('falls back to a placeholder when every section is hidden', () => {
    expect(
      parseReleaseNotes('## New Contributors\n* @infybtw made their first contribution'),
    ).toEqual([
      { kind: 'other', items: [{ label: '', description: 'No release notes available.' }] },
    ])
  })

  test('groups changes by kind in a stable order', () => {
    const notes = `## Changes
* Add emote search
* Cache avatar images
* Fix scroll jump
* Remove the legacy overlay
* Document the dev workflow
* Tweak the tooltip shadow`

    expect(parseReleaseNotes(notes)).toEqual([
      { kind: 'new', items: [{ label: 'Adding emote search', description: 'Add emote search' }] },
      {
        kind: 'improved',
        items: [{ label: 'Caching avatar images', description: 'Cache avatar images' }],
      },
      { kind: 'fixed', items: [{ label: 'Fixing scroll jump', description: 'Fix scroll jump' }] },
      {
        kind: 'removed',
        items: [{ label: 'Removing the legacy overlay', description: 'Remove the legacy overlay' }],
      },
      {
        kind: 'docs',
        items: [
          { label: 'Documenting the dev workflow', description: 'Document the dev workflow' },
        ],
      },
      {
        kind: 'other',
        items: [{ label: 'Tweaking the tooltip shadow', description: 'Tweak the tooltip shadow' }],
      },
    ])
  })
})

describe('formatReleaseDate', () => {
  test('formats the GitHub timestamp as a UTC calendar date', () => {
    expect(formatReleaseDate('2026-11-08T17:20:39Z')).toBe('Nov 8, 2026')
  })

  test('returns null for missing or invalid timestamps', () => {
    expect(formatReleaseDate('')).toBeNull()
    expect(formatReleaseDate('not-a-date')).toBeNull()
  })
})
