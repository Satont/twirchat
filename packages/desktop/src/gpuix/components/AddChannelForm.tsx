/**
 * Add-channel form — port of AddChannelForm.vue (platform selector + slug
 * input + confirm/cancel). Used inside empty panels and the add modal.
 */

import { useState } from 'react'

import { platformColor, withAlpha } from '../theme'
import { trackTextInputFocus } from '../state/focus'
import { useTheme } from '../theme-context'
import { useStore } from '../state/create-store'
import { accountsStore } from '../state/app'
import { Icon, PlatformIcon } from './ui/Icon'
import { Text } from './ui/Text'

type FormPlatform = 'twitch' | 'kick' | 'youtube'

export function AddChannelForm({
  cancelable,
  onConfirm,
  onCancel,
}: {
  cancelable?: boolean
  onConfirm: (platform: FormPlatform, channelSlug: string) => void
  onCancel?: () => void
}) {
  const theme = useTheme()
  const accounts = useStore(accountsStore)
  const youtubeAuthenticated = accounts.some((a) => a.platform === 'youtube')
  const [platform, setPlatform] = useState<FormPlatform>('twitch')
  const [slug, setSlug] = useState('')
  const [inputFocused, setInputFocused] = useState(false)

  const placeholder =
    platform === 'twitch'
      ? 'Twitch channel name'
      : platform === 'kick'
        ? 'Kick channel name'
        : 'YouTube channel handle or ID'

  const confirm = () => {
    const trimmed = slug.trim().toLowerCase()
    if (!trimmed) return
    onConfirm(platform, trimmed)
    setSlug('')
  }

  const selectPlatform = (p: FormPlatform) => {
    if (p === 'youtube' && !youtubeAuthenticated) return
    setPlatform(p)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
        {(['twitch', 'kick', 'youtube'] as const).map((p) => {
          const active = platform === p
          const disabled = p === 'youtube' && !youtubeAuthenticated
          const color = platformColor(p)
          return (
            <div
              key={p}
              testId={`add-platform-${p}`}
              onClick={() => selectPlatform(p)}
              style={{
                flexGrow: 1,
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingTop: 7,
                paddingBottom: 7,
                paddingLeft: 12,
                paddingRight: 12,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: active ? withAlpha(color, 0.45) : 'rgba(255, 255, 255, 0.1)',
                backgroundColor: active ? withAlpha(color, 0.15) : 'rgba(255, 255, 255, 0.04)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.35 : 1,
                userSelect: 'none',
                hover: active
                  ? undefined
                  : { backgroundColor: disabled ? undefined : 'rgba(255, 255, 255, 0.07)' },
              }}
            >
              <PlatformIcon platform={p} size={14} color={active ? color : theme.text2} />
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: active ? color : theme.text2,
                }}
              >
                {p === 'youtube' ? 'YouTube' : p === 'twitch' ? 'Twitch' : 'Kick'}
              </Text>
              {disabled ? <Icon name="lock" size={11} color={theme.text2} /> : null}
            </div>
          )
        })}
      </div>

      <div
        style={{
          display: 'flex',
          backgroundColor: theme.surface2,
          borderWidth: 1,
          borderColor: inputFocused ? 'rgba(167, 139, 250, 0.5)' : theme.border,
          borderRadius: 8,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 12,
          paddingRight: 12,
        }}
      >
        <input
          testId="add-channel-input"
          autoFocus
          value={slug}
          placeholder={placeholder}
          onChange={(event) => setSlug(event.value ?? '')}
          onSubmit={confirm}
          onFocus={() => {
            setInputFocused(true)
            trackTextInputFocus(true)
          }}
          onBlur={() => {
            setInputFocused(false)
            trackTextInputFocus(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'escape') onCancel?.()
          }}
          theme={{ caret: '#a78bfa' }}
          style={{ flexGrow: 1, minWidth: 0, fontSize: 13, color: theme.text }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          gap: 8,
          justifyContent: 'flex-end',
        }}
      >
        {cancelable ? (
          <div
            onClick={onCancel}
            style={{
              paddingTop: 7,
              paddingBottom: 7,
              paddingLeft: 14,
              paddingRight: 14,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: 'rgba(255, 255, 255, 0.1)',
              cursor: 'pointer',
              hover: { backgroundColor: 'rgba(255, 255, 255, 0.06)' },
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: 500, color: theme.text2 }}>Cancel</Text>
          </div>
        ) : null}
        <div
          testId="add-channel-confirm"
          onClick={confirm}
          style={{
            paddingTop: 7,
            paddingBottom: 7,
            paddingLeft: 16,
            paddingRight: 16,
            borderRadius: 8,
            backgroundColor: '#7c3aed',
            cursor: slug.trim() ? 'pointer' : 'default',
            opacity: slug.trim() ? 1 : 0.4,
            hover: { backgroundColor: slug.trim() ? '#6d28d9' : '#7c3aed' },
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>Add</Text>
        </div>
      </div>
    </div>
  )
}
