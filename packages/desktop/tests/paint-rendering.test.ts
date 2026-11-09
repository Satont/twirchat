import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'

import { paintNameSvg, type CosmeticPaint } from '../src/services/cosmetics'
import {
  createPaintRenderer,
  PAINT_GLYPH_HORIZONTAL_PADDING,
  PAINT_GLYPH_VERTICAL_PADDING,
} from '../src/services/paint-renderer'
import { required } from './fixture-values'

const glyphWidth = 96
const glyphHeight = 32
const left = PAINT_GLYPH_HORIZONTAL_PADDING
const top = PAINT_GLYPH_VERTICAL_PADDING
const width = glyphWidth + 2 * left
const height = glyphHeight + 2 * top
const red = '#ff0000'
const blue = '#0000ff'
const stops = [
  { at: 0, color: red },
  { at: 1, color: blue },
]
const repeatingStops = [
  { at: 0.25, color: red },
  { at: 0.375, color: red },
  { at: 0.375, color: blue },
  { at: 0.5, color: blue },
]

async function rasterize(layers: CosmeticPaint['layers'], shadows: CosmeticPaint['shadows'] = []) {
  const mask = await sharp({
    create: { width: glyphWidth, height: glyphHeight, channels: 4, background: 'white' },
  })
    .extend({ left, right: left, top, bottom: top, background: 'transparent' })
    .png()
    .toBuffer()
  const { svg } = paintNameSvg(
    'Viewer',
    { id: 'test', name: 'Test', layers, shadows },
    14,
    'Inter',
    {
      imageUrl: `data:image/png;base64,${mask.toString('base64')}`,
      width,
      height,
    },
  )
  const pixels = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer()
  return (x: number, y: number) => {
    const index = ((top + y) * width + left + x) * 4
    return {
      red: required(pixels[index]),
      blue: required(pixels[index + 2]),
      alpha: required(pixels[index + 3]),
    }
  }
}

test('projects a CSS diagonal onto the actual width and height of the glyph box', async () => {
  const pixel = await rasterize([
    { type: 'linear', angle: 45, repeating: false, stops, opacity: 1 },
  ])
  expect(pixel(0, 0).red).toBeGreaterThan(180)
  expect(pixel(95, 0).red).toBeLessThan(5)
  expect(pixel(0, 31).blue).toBeLessThan(5)
  expect(pixel(-1, 0).alpha).toBe(0)
})

test('uses farthest-corner radial gradients and preserves explicit ellipses', async () => {
  const circle = await rasterize([
    { type: 'radial', shape: 'CIRCLE', repeating: false, stops, opacity: 1 },
  ])
  const ellipse = await rasterize([
    { type: 'radial', shape: 'ELLIPSE', repeating: false, stops, opacity: 1 },
  ])
  expect(circle(48, 0).blue).toBeLessThan(85)
  expect(ellipse(48, 0).blue).toBeGreaterThan(160)
  expect(circle(0, 0).blue).toBeGreaterThan(245)
  expect(ellipse(0, 0).blue).toBeGreaterThan(245)
})

test('repeats between the first and last stop and retains hard edges', async () => {
  const pixel = await rasterize([
    {
      type: 'linear',
      angle: 90,
      repeating: true,
      stops: repeatingStops,
      opacity: 1,
    },
  ])
  expect(pixel(6, 16).red).toBe(255)
  expect(pixel(18, 16).blue).toBe(255)
  expect(pixel(30, 16).red).toBe(255)
  expect(pixel(42, 16).blue).toBe(255)
})

test('repeats a radial gradient inward as well as outward from its first stop', async () => {
  const pixel = await rasterize([
    {
      type: 'radial',
      shape: 'CIRCLE',
      repeating: true,
      stops: repeatingStops,
      opacity: 1,
    },
  ])
  expect(pixel(50, 16).red).toBe(255)
  expect(pixel(57, 16).blue).toBe(255)
  expect(pixel(63, 16).red).toBe(255)
  expect(pixel(70, 16).blue).toBe(255)
})

test('interpolates mixed-alpha stops in premultiplied sRGB before applying layer opacity', async () => {
  const pixel = await rasterize([
    {
      type: 'linear',
      angle: 90,
      repeating: false,
      stops: [
        { at: 0, color: '#ff000000' },
        { at: 1, color: blue },
      ],
      opacity: 0.5,
    },
  ])
  const midpoint = pixel(47, 16)
  expect(midpoint.red).toBe(0)
  expect(midpoint.blue).toBeGreaterThanOrEqual(250)
  expect(midpoint.alpha).toBeGreaterThanOrEqual(62)
  expect(midpoint.alpha).toBeLessThanOrEqual(64)
  expect(pixel(-1, 16).alpha).toBe(0)
})

test('paints independent shadows behind the fill with the first shadow on top', async () => {
  const pixel = await rasterize(
    [{ type: 'color', color: '#00ff00', opacity: 1 }],
    [
      { color: red, offsetX: -3, offsetY: 0, blur: 0 },
      { color: blue, offsetX: -3, offsetY: 0, blur: 0 },
    ],
  )
  expect(pixel(-2, 10)).toEqual({ red: 255, blue: 0, alpha: 255 })
  expect(pixel(-5, 10).alpha).toBe(0)
  expect(pixel(2, 10)).toEqual({ red: 0, blue: 0, alpha: 255 })
})

test('covers the glyph box with an image anchored at its top-left corner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twir-paint-crop-'))
  try {
    const image = await sharp({
      create: { width: 32, height: 128, channels: 3, background: blue },
    })
      .composite([
        {
          input: { create: { width: 32, height: 64, channels: 3, background: red } },
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer()
    const renderer = createPaintRenderer({
      directory: () => directory,
      fetch: async () => new Response(image),
    })
    const paint: CosmeticPaint = {
      id: 'test',
      name: 'Test',
      layers: [
        { type: 'color', color: blue, opacity: 1 },
        { type: 'image', imageUrl: 'https://cdn.7tv.app/paint/test/1x.webp', opacity: 1 },
      ],
      shadows: [],
    }
    const output = await renderer.render('MMMMMMMM', paint, 20, 'Inter', paintNameSvg)
    const pixels = await sharp(output.path).ensureAlpha().raw().toBuffer()
    let opaquePixels = 0
    let bluePixels = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (required(pixels[index + 3]) < 240) continue
      opaquePixels++
      if (required(pixels[index + 2]) > required(pixels[index])) bluePixels++
    }
    expect(opaquePixels).toBeGreaterThan(0)
    expect(bluePixels).toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
