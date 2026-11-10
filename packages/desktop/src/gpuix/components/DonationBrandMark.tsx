import type { DonationProvider } from '@twirchat/shared/donations'
import { memo } from 'react'

import marks from '../assets/donation-brand-marks.json'

export const DONATION_BRAND_ACCENTS: Record<DonationProvider, string> = {
  donationalerts: '#F59C07',
  donatepay: '#44AB4F',
  memealerts: '#EA612B',
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

const brandMarks = {
  // https://www.donationalerts.com/img/brand/da.svg
  donationalerts: {
    src: svgDataUrl(marks.donationAlertsSvg),
    plate: '#191919',
    scale: 0.62,
  },
  // https://donatepay.ru/page/brand — mini logo
  donatepay: {
    src: svgDataUrl(marks.donatePaySvg),
    plate: '#121212',
    scale: 0.81,
  },
  // https://memealerts.com/android-chrome-192x192.png?v=2
  memealerts: {
    src: `data:image/png;base64,${marks.memeAlertsPngBase64}`,
    plate: '#FFF0DD',
    scale: 0.79,
  },
} satisfies Record<DonationProvider, { src: string; plate: string; scale: number }>

interface DonationBrandMarkProps {
  provider: DonationProvider
  size: number
}

export const DonationBrandMark = memo(function DonationBrandMark({
  provider,
  size,
}: DonationBrandMarkProps) {
  const { src, plate, scale } = brandMarks[provider]
  const markSize = Math.round(size * scale)
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
        backgroundColor: plate,
        pointerEvents: 'none',
      }}
    >
      <img src={src} objectFit="contain" style={{ width: markSize, height: markSize }} />
    </div>
  )
})
