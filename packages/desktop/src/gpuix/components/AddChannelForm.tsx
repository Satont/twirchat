/**
 * Add-channel form — port of AddChannelForm.vue (platform selector + slug
 * input + confirm/cancel). Used inside empty panels and the add modal.
 */

import type { PublicInstance } from '@gpuix/react'
import { useState, type Ref } from 'react'

import type { PluginTransportInfo } from '../../plugins/api'
import { sanitizeDisplayText } from '../../views/shared/utils/display-text'
import { isPluginPlatform, type WatchedPlatform } from '../../watched-channels/plugin-channel-types'
import { useBackend, useBackendEvent } from '../backend/context'
import { usePopupHotkeys } from '../hooks/use-popup-hotkeys'
import { useTextInputFocusTracking } from '../state/focus'
import { platformColor, withAlpha } from '../theme'
import { useTheme } from '../theme-context'
import { PlatformIcon } from './ui/Icon'
import { Text } from './ui/Text'

type FormPlatform = 'twitch' | 'kick' | 'youtube'
const noPluginTransports: readonly PluginTransportInfo[] = []

export function AddChannelForm({
  cancelable,
  autoFocus = true,
  popup = false,
  popupContextId,
  inputRef,
  onFocus,
  onConfirm,
  onCancel,
}: {
  cancelable?: boolean
  autoFocus?: boolean
  popup?: boolean
  popupContextId?: string
  inputRef?: Ref<PublicInstance>
  onFocus?: () => void
  onConfirm: (platform: WatchedPlatform, channelSlug: string) => void
  onCancel?: () => void
}) {
  const theme = useTheme()
  const { api, plugins } = useBackend()
  const readTransports = () => (plugins ? api.getPluginTransports() : noPluginTransports)
  const [transports, setTransports] = useState(readTransports)
  useBackendEvent('plugins_changed', () => setTransports(readTransports()))
  const [platform, setPlatform] = useState<WatchedPlatform>('twitch')
  const transport = transports.find((item) => item.platform === platform)
  const unavailable = isPluginPlatform(platform) && !transport
  const [slug, setSlug] = useState('')
  const [inputFocused, setInputFocused] = useState(false)
  const inputFocus = useTextInputFocusTracking(setInputFocused)

  const canConfirm = !unavailable && Boolean(slug.trim())
  const placeholder = unavailable
    ? 'Select an available platform'
    : transport
      ? `${sanitizeDisplayText(transport.name)} channel identifier`
      : platform === 'twitch'
        ? 'Twitch channel name'
        : platform === 'kick'
          ? 'Kick channel name'
          : 'YouTube channel handle or ID'

  const confirm = () => {
    if (!canConfirm) return
    const trimmed =
      platform === 'youtube' || isPluginPlatform(platform) ? slug.trim() : slug.trim().toLowerCase()
    onConfirm(platform, trimmed)
    setSlug('')
  }

  usePopupHotkeys(
    'add-channel',
    { accept: canConfirm ? confirm : null, reject: onCancel ?? null },
    popup,
    popupContextId,
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
        {(['twitch', 'kick', 'youtube'] satisfies FormPlatform[]).map((p) => {
          const active = platform === p
          const color = platformColor(p)
          return (
            <div
              key={p}
              testId={`add-platform-${p}`}
              onClick={() => setPlatform(p)}
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
                borderColor: active ? withAlpha(color, 0.45) : theme.hairline,
                backgroundColor: active ? withAlpha(color, 0.15) : theme.fill,
                cursor: 'pointer',
                userSelect: 'none',
                hover: active ? undefined : { backgroundColor: theme.fillHover },
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
            </div>
          )
        })}
      </div>
      {transports.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Text style={{ fontSize: 11, color: theme.text2 }}>Plugin platforms</Text>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              maxHeight: 100,
              overflowY: 'scroll',
            }}
          >
            {transports.map((item) => {
              const active = platform === item.platform
              return (
                <div
                  key={item.platform}
                  testId={`add-platform-${item.platform}`}
                  tabIndex={0}
                  aria-label={`Use ${sanitizeDisplayText(item.name)}`}
                  onClick={() => setPlatform(item.platform)}
                  onKeyDown={(event) => {
                    if (event.key === 'enter' || event.key === 'space') {
                      event.preventDefault()
                      event.stopPropagation()
                      setPlatform(item.platform)
                    }
                  }}
                  style={{
                    padding: 5,
                    borderRadius: 5,
                    backgroundColor: active ? theme.fillHover : theme.fill,
                    cursor: 'pointer',
                    hover: { backgroundColor: theme.fillHover },
                    focusVisible: { outlineWidth: 1, outlineColor: theme.link },
                  }}
                >
                  <Text style={{ fontSize: 12, color: active ? theme.link : theme.text }}>
                    {sanitizeDisplayText(item.name)}
                  </Text>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      <div
        style={{
          display: 'flex',
          backgroundColor: theme.surface2,
          borderWidth: 1,
          borderColor: inputFocused ? withAlpha(theme.accent.primary, 0.5) : theme.border,
          borderRadius: 8,
          paddingTop: 8,
          paddingBottom: 8,
          paddingLeft: 12,
          paddingRight: 12,
        }}
      >
        <input
          ref={inputRef}
          testId="add-channel-input"
          autoFocus={autoFocus}
          value={slug}
          placeholder={placeholder}
          onChange={(event) => setSlug(event.value ?? '')}
          onSubmit={confirm}
          {...inputFocus}
          onFocus={() => {
            inputFocus.onFocus()
            onFocus?.()
          }}
          onKeyDown={(event) => {
            if (event.key === 'escape') onCancel?.()
          }}
          theme={{ caret: theme.accent.primary }}
          style={{ flexGrow: 1, minWidth: 0, fontSize: 13, color: theme.text }}
        />
      </div>

      {platform === 'youtube' ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>
          Enter an @handle or a case-sensitive UC channel ID.
        </Text>
      ) : null}
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
              borderColor: theme.hairline,
              cursor: 'pointer',
              hover: { backgroundColor: theme.fillHover },
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
            backgroundColor: theme.accent.deep,
            cursor: canConfirm ? 'pointer' : 'default',
            opacity: canConfirm ? 1 : 0.4,
            hover: { backgroundColor: canConfirm ? theme.accent.deepHover : theme.accent.deep },
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: 600, color: theme.accent.onDeep }}>Add</Text>
        </div>
      </div>
    </div>
  )
}
