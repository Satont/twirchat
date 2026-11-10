import type { DonationProvider } from '@twirchat/shared/donations'
import { memo, useMemo } from 'react'

import marks from '../assets/donation-brand-marks.json'

export const DONATION_BRAND_ACCENTS: Record<DonationProvider, string> = {
  donationalerts: '#F59C07',
  donatepay: '#44AB4F',
  memealerts: '#EA612B',
}

// GPUI rasterizes an SVG <img> at its intrinsic size and shrinks that bitmap to the box, which
// leaves small marks soft and jagged. Like image thumbnails, the mark is rasterized at 2× the
// painted size (GPUIX exposes no display scale); the viewBox keeps it centred.
const SVG_RASTER_SCALE = 2

function svgDataUrl(svg: string, paintedSize: number): string {
  const size = paintedSize * SVG_RASTER_SCALE
  const sized = svg.replace(
    /^<svg\b[^>]*>/u,
    (tag) =>
      `<svg width="${size}" height="${size}"${tag.slice(4).replace(/\s(?:width|height)="[^"]*"/gu, '')}`,
  )
  return `data:image/svg+xml;base64,${Buffer.from(sized).toString('base64')}`
}

type BrandMark = ({ svg: string } | { png: string }) & { plate: string; scale: number }

const brandMarks = {
  // https://www.donationalerts.com/img/brand/da.svg
  donationalerts: {
    svg: marks.donationAlertsSvg,
    plate: '#191919',
    scale: 0.62,
  },
  // https://donatepay.ru/page/brand — mini logo
  donatepay: {
    svg: marks.donatePaySvg,
    plate: '#121212',
    scale: 0.81,
  },
  // https://memealerts.com/android-chrome-192x192.png?v=2
  memealerts: {
    png: `data:image/png;base64,${marks.memeAlertsPngBase64}`,
    plate: '#FFF0DD',
    scale: 0.79,
  },
} satisfies Record<DonationProvider, BrandMark>

interface DonationBrandMarkProps {
  provider: DonationProvider
  size: number
}

export const DonationBrandMark = memo(function DonationBrandMark({
  provider,
  size,
}: DonationBrandMarkProps) {
  const mark: BrandMark = brandMarks[provider]
  const markSize = Math.round(size * mark.scale)
  const src = useMemo(
    () => ('svg' in mark ? svgDataUrl(mark.svg, markSize) : mark.png),
    [mark, markSize],
  )
  return (
    <div
      testId={`donation-brand-mark-${provider}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: Math.round(size / 4),
        backgroundColor: mark.plate,
        pointerEvents: 'none',
      }}
    >
      <img src={src} objectFit="contain" style={{ width: markSize, height: markSize }} />
    </div>
  )
})
