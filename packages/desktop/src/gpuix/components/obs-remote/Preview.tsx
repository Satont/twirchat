import { useEffect, useState } from 'react'

import type { ObsRemoteConnection } from '../../backend/obs-remote'
import { useTheme } from '../../theme-context'
import { Text } from '../ui/Text'

export function Preview({
  connection,
  source,
  active,
  width,
  label,
  testId,
  thumbnail = false,
}: {
  connection: ObsRemoteConnection
  source: string
  active: boolean
  width: number
  label?: string
  testId?: string
  thumbnail?: boolean
}) {
  const [image, setImage] = useState('')
  const [error, setError] = useState('')
  const theme = useTheme()
  useEffect(() => {
    if (!active || !source) return undefined
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function refresh() {
      try {
        const next = await connection.preview(source, thumbnail ? 192 : 960)
        if (!cancelled) {
          setImage(next)
          setError('')
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Preview unavailable')
      }
      if (!cancelled && !thumbnail)
        timer = setTimeout(() => {
          refresh().catch((cause) => {
            if (!cancelled) setError(cause instanceof Error ? cause.message : 'Preview unavailable')
          })
        }, 1000)
    }
    refresh().catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Preview unavailable')
    })
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [connection, source, active, thumbnail])
  return (
    <div
      testId={testId}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, width, minWidth: 0 }}
    >
      {label ? (
        <Text
          style={{
            color: label === 'PROGRAM' ? theme.dangerText : theme.successText,
            fontWeight: 600,
            fontSize: 11,
          }}
        >
          {`${label} · ${source || 'No scene'}`}
        </Text>
      ) : null}
      <div
        style={{
          width,
          height: Math.round((width * 9) / 16),
          backgroundColor: '#101014',
          borderRadius: 6,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {image ? (
          <img
            src={image}
            objectFit="contain"
            style={{ width, height: Math.round((width * 9) / 16) }}
          />
        ) : (
          <Text style={{ color: theme.text2, fontSize: 11 }}>
            {error || (active ? 'Loading preview…' : 'Preview paused')}
          </Text>
        )}
      </div>
    </div>
  )
}
