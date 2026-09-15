/**
 * Emote hover tooltip — port of EmoteTooltip.vue onto the GPUIX Tooltip
 * primitive: 64px preview, name, "View on 7TV" link.
 */

import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@gpuix/react'
import type { Emote } from '@twirchat/shared/types'

import { useBackend } from '../../backend/context'
import { elevated } from '../../theme'
import { useFont } from '../../theme-context'
import { Icon } from './Icon'
import { RemoteImage } from './RemoteImage'

export function EmoteTooltip({ emote, children }: { emote: Emote; children: ReactNode }) {
  const backend = useBackend()
  const font = useFont()
  const url = `https://7tv.app/emotes/${emote.id}`

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        style={{
          backgroundColor: elevated.tooltip,
          borderWidth: 1,
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderRadius: 10,
          padding: 12,
          minWidth: 140,
          boxShadow: {
            offsetX: 0,
            offsetY: 8,
            blurRadius: 32,
            spreadRadius: 0,
            color: '#00000080',
          },
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <div
            style={{
              width: 64,
              height: 64,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.06)',
              borderRadius: 8,
              flexShrink: 0,
            }}
          >
            <RemoteImage
              url={emote.imageUrl}
              objectFit="contain"
              style={{ width: 56, height: 56 }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <text style={{ fontSize: 13, fontWeight: 600, color: '#e2e2e8', fontFamily: font }}>
              {emote.name}
            </text>
            <div
              onClick={() => void backend.api.openExternalUrl({ url })}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer',
              }}
            >
              <Icon name="externalLink" size={12} color="#a78bfa" />
              <text style={{ fontSize: 12, color: '#a78bfa', fontFamily: font }}>View on 7TV</text>
            </div>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
