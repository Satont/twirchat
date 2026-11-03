/**
 * Generate all platform icons from SVG source using Sharp or ImageMagick
 *
 * Requirements: sharp OR ImageMagick (convert)
 * Run: bun scripts/generate-icons.ts
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ASSETS_DIR = join(import.meta.dir, '..', 'packages', 'desktop', 'assets')
const SVG_SOURCE = join(ASSETS_DIR, 'icon.svg')

// Icon sizes for each platform
const PNG_SIZE = 256
const ICO_SIZES = [16, 32, 48, 64, 128, 256]
const ICONSET_SIZES = [
  { px: 16, retina: true },
  { px: 32, retina: true },
  { px: 64, retina: true },
  { px: 128, retina: true },
  { px: 256, retina: true },
  { px: 512, retina: true },
  { px: 1024, retina: false },
]

async function main() {
  console.log('🎨 Generating platform icons...\n')

  // Ensure assets directory exists
  mkdirSync(ASSETS_DIR, { recursive: true })

  // Check for SVG source
  if (!existsSync(SVG_SOURCE)) {
    console.error(`❌ Source SVG not found: ${SVG_SOURCE}`)
    console.log('   Create an icon.svg file first!')
    process.exit(1)
  }

  // Try to use ImageMagick first (faster for batch operations)
  const hasImageMagick = checkCommand('magick') || checkCommand('convert')
  const hasSharp = await checkSharp()

  if (hasImageMagick) {
    console.log('📦 Using ImageMagick for icon generation\n')
    await generateWithImageMagick()
  } else if (hasSharp) {
    console.log('📦 Using Sharp for icon generation\n')
    await generateWithSharp()
  } else {
    console.error('❌ No image processing tools found!')
    console.log('   Install one of:')
    console.log('   • ImageMagick: sudo apt install imagemagick')
    console.log('   • Sharp: bun add -d sharp')
    process.exit(1)
  }

  console.log('\n✅ All icons generated successfully!')
  console.log(`   Location: ${ASSETS_DIR}/`)
  console.log('\n📋 Generated files:')
  console.log('   • icon.png - Linux desktop entry')
  console.log('   • icon.ico - Windows application icon')
  console.log('   • icon.iconset/ - macOS application icons')
}

function checkCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function checkSharp(): Promise<boolean> {
  try {
    await import('sharp')
    return true
  } catch {
    return false
  }
}

async function generateWithImageMagick() {
  const convertCmd = checkCommand('magick') ? 'magick' : 'convert'

  // Generate PNG for Linux
  console.log('📱 Generating PNG (Linux)...')
  execSync(
    `${convertCmd} -background none -density 300 -resize ${PNG_SIZE}x${PNG_SIZE} "${SVG_SOURCE}" "${join(ASSETS_DIR, 'icon.png')}"`,
  )
  console.log(`   ✓ icon.png (${PNG_SIZE}x${PNG_SIZE})`)

  // Generate ICO for Windows
  console.log('\n🪟 Generating ICO (Windows)...')
  const icoCmd = ICO_SIZES.map(
    (size) => `${convertCmd} -background none -density 300 -resize ${size}x${size} "${SVG_SOURCE}"`,
  ).join(' ')
  execSync(`${icoCmd} "${join(ASSETS_DIR, 'icon.ico')}"`)
  console.log(`   ✓ icon.ico (${ICO_SIZES.join(', ')})`)

  // Generate iconset for macOS
  console.log('\n🍎 Generating iconset (macOS)...')
  const iconsetDir = join(ASSETS_DIR, 'icon.iconset')
  if (existsSync(iconsetDir)) {
    rmSync(iconsetDir, { recursive: true })
  }
  mkdirSync(iconsetDir)

  for (const { px, retina } of ICONSET_SIZES) {
    // Standard size
    execSync(
      `${convertCmd} -background none -density 300 -resize ${px}x${px} "${SVG_SOURCE}" "${join(iconsetDir, `icon_${px}x${px}.png`)}"`,
    )

    // Retina size
    if (retina) {
      const retinaPx = px * 2
      execSync(
        `${convertCmd} -background none -density 300 -resize ${retinaPx}x${retinaPx} "${SVG_SOURCE}" "${join(iconsetDir, `icon_${px}x${px}@2x.png`)}"`,
      )
    }
  }
  console.log(`   ✓ icon.iconset/ (${ICONSET_SIZES.length} sizes + @2x variants)`)
}

async function generateWithSharp() {
  const sharp = (await import('sharp')).default
  const svgBuffer = readFileSync(SVG_SOURCE)

  // Generate PNG for Linux
  console.log('📱 Generating PNG (Linux)...')
  const pngBuffer = await sharp(svgBuffer, { density: 300 })
    .resize(PNG_SIZE, PNG_SIZE)
    .png()
    .toBuffer()
  writeFileSync(join(ASSETS_DIR, 'icon.png'), pngBuffer)
  console.log(`   ✓ icon.png (${PNG_SIZE}x${PNG_SIZE})`)

  // Generate ICO for Windows
  console.log('\n🪟 Generating ICO (Windows)...')
  try {
    const { default: pngToIco } = await import('png-to-ico')
    const pngBuffers = []
    for (const size of ICO_SIZES) {
      const buf = await sharp(svgBuffer, { density: 300 }).resize(size, size).png().toBuffer()
      pngBuffers.push(buf)
    }
    const icoBuffer = await pngToIco(pngBuffers)
    writeFileSync(join(ASSETS_DIR, 'icon.ico'), icoBuffer)
    console.log(`   ✓ icon.ico (${ICO_SIZES.join(', ')})`)
  } catch {
    console.log('   ⚠️  png-to-ico not available, install with: bun add -d png-to-ico')
  }

  // Generate iconset for macOS
  console.log('\n🍎 Generating iconset (macOS)...')
  const iconsetDir = join(ASSETS_DIR, 'icon.iconset')
  if (existsSync(iconsetDir)) {
    rmSync(iconsetDir, { recursive: true })
  }
  mkdirSync(iconsetDir)

  for (const { px, retina } of ICONSET_SIZES) {
    // Standard size
    const buffer = await sharp(svgBuffer, { density: 300 }).resize(px, px).png().toBuffer()
    writeFileSync(join(iconsetDir, `icon_${px}x${px}.png`), buffer)

    // Retina size
    if (retina) {
      const retinaPx = px * 2
      const retinaBuffer = await sharp(svgBuffer, { density: 600 })
        .resize(retinaPx, retinaPx)
        .png()
        .toBuffer()
      writeFileSync(join(iconsetDir, `icon_${px}x${px}@2x.png`), retinaBuffer)
    }
  }
  console.log(`   ✓ icon.iconset/ (${ICONSET_SIZES.length} sizes + @2x variants)`)
}

main().catch((error) => {
  console.error('\n❌ Error generating icons:', error)
  process.exit(1)
})
