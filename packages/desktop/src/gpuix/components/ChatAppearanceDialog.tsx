/**
 * Chat appearance dialog — font-size slider, seven display switches,
 * Modern/Compact theme cards and a live preview panel. The gear button opens
 * one modal: preview on the left, controls on the right. Changes apply live
 * AND persist (saveSettings) immediately, matching the Vue handler in
 * ChatList.vue.
 */

import { useGpuixRequired, useWindowSize } from '@gpuix/react'
import type { AppSettings } from '@twirchat/shared/types'
import { useEffect, useState } from 'react'

import { useBackend } from '../backend/context'
import { settingsStore } from '../state/app'
import { useTheme } from '../theme-context'
import { ChatAppearancePreview } from './ChatAppearancePreview'
import { Icon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { Slider } from './ui/Slider'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'

export function ChatAppearanceDialog({ settings }: { settings: AppSettings }) {
  const theme = useTheme()
  const backend = useBackend()
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const renderer = useGpuixRequired()
  const windowSize = useWindowSize()
  const narrow = windowSize.width < 820

  // Clicking the trigger doesn't blur a focused text editor, which would
  // block the window-level ESC handler — drop that focus on open.
  useEffect(() => {
    if (open) renderer.blur?.()
  }, [open, renderer])

  const patch = (partial: Partial<AppSettings>) => {
    const next = { ...settings, ...partial }
    settingsStore.set(next)
    void backend.api.saveSettings(next).catch((error) => {
      console.warn('[appearance] saveSettings failed:', error)
    })
  }

  const toggles: { key: keyof AppSettings; label: string }[] = [
    { key: 'showPlatformColorStripe', label: 'Color stripe' },
    { key: 'showPlatformIcon', label: 'Platform icon' },
    { key: 'showAvatars', label: 'Avatars' },
    { key: 'showBadges', label: 'Badges' },
    { key: 'showTimestamp', label: 'Timestamp' },
    { key: 'showChannelLabel', label: 'Channel label' },
    { key: 'emoteSessionCache', label: 'Session emote cache' },
  ]

  return (
    <div style={{ position: 'relative' }}>
      <div
        testId="appearance-button"
        onClick={() => setOpen(true)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          paddingTop: 4,
          paddingBottom: 4,
          paddingLeft: 6,
          paddingRight: 6,
          borderRadius: 6,
          cursor: 'pointer',
          display: 'flex',
          backgroundColor: hovered ? theme.fillHover : undefined,
        }}
      >
        <Icon name="settings" size={16} color={hovered ? theme.text : theme.text2} />
      </div>

      {open ? (
        <Modal width={780} onClose={() => setOpen(false)}>
          <div
            testId="appearance-dialog"
            style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
          >
            <div
              style={{
                flexShrink: 0,
                paddingTop: 18,
                paddingBottom: 18,
                paddingLeft: 20,
                paddingRight: 20,
                borderBottomWidth: 1,
                borderColor: theme.border,
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Text style={{ fontSize: 16, fontWeight: 700, color: theme.text }}>
                  Chat appearance
                </Text>
                <Text style={{ fontSize: 11, color: theme.text2 }}>
                  Preview updates as you change the options.
                </Text>
              </div>
              <div
                testId="appearance-close"
                role="button"
                aria-label="Close chat appearance"
                tabIndex={0}
                onClick={() => setOpen(false)}
                onKeyDown={(event) => {
                  if (event.key === 'enter' || event.key === 'space') {
                    event.preventDefault()
                    setOpen(false)
                  }
                }}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 7,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0,
                  hover: { backgroundColor: theme.fillHover },
                }}
              >
                <Icon name="close" size={18} color={theme.text2} />
              </div>
            </div>

            <div
              style={{
                flexGrow: 1,
                minHeight: 0,
                overflowY: 'auto',
                padding: 20,
                display: 'flex',
                flexDirection: narrow ? 'column' : 'row',
                gap: 16,
              }}
            >
              <div
                style={{
                  flexGrow: 1,
                  minWidth: 0,
                  backgroundColor: theme.surface,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 12,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: 700, color: theme.text2 }}>
                    {'Preview'.toUpperCase()}
                  </Text>
                  <Text style={{ fontSize: 10, color: theme.text2 }}>Live</Text>
                </div>
                <ChatAppearancePreview settings={settings} height={narrow ? 240 : 360} />
                <Text style={{ fontSize: 10, color: theme.text2 }}>
                  Sample messages use your current theme, font and chat layout.
                </Text>
              </div>

              <div
                style={{
                  width: narrow ? '100%' : 300,
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {/* Font size */}
                <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column' }}>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 10,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: 600, color: theme.text2 }}>
                      {'Font size'.toUpperCase()}
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: 500, color: theme.text }}>
                      {`${settings.fontSize}px`}
                    </Text>
                  </div>
                  <Slider
                    value={settings.fontSize}
                    min={11}
                    max={22}
                    width={narrow ? 208 : 260}
                    onChange={(fontSize) => patch({ fontSize })}
                  />
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      marginTop: 4,
                    }}
                  >
                    <Text style={{ fontSize: 10, color: theme.text2 }}>11</Text>
                    <Text style={{ fontSize: 10, color: theme.text2 }}>22</Text>
                  </div>
                </div>

                {/* Display toggles */}
                <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column' }}>
                  <Text
                    style={{ fontSize: 12, fontWeight: 600, color: theme.text2, marginBottom: 10 }}
                  >
                    {'Display'.toUpperCase()}
                  </Text>
                  {toggles.map((toggle, index) => (
                    <div
                      key={toggle.key}
                      style={{
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingTop: index === 0 ? 0 : 7,
                        paddingBottom: 7,
                        borderBottomWidth: index === toggles.length - 1 ? 0 : 1,
                        borderColor: theme.divider,
                      }}
                    >
                      <Text style={{ fontSize: 13, color: theme.text }}>{toggle.label}</Text>
                      <Switch
                        small
                        checked={Boolean(settings[toggle.key])}
                        onChange={(value) => patch({ [toggle.key]: value })}
                      />
                    </div>
                  ))}
                </div>

                {/* Theme cards */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <Text
                    style={{ fontSize: 12, fontWeight: 600, color: theme.text2, marginBottom: 10 }}
                  >
                    {'Layout'.toUpperCase()}
                  </Text>
                  <div style={{ display: 'flex', flexDirection: 'row', gap: 10 }}>
                    <ThemeCard
                      label="Modern"
                      active={settings.chatTheme === 'modern'}
                      onClick={() => patch({ chatTheme: 'modern' })}
                      preview="modern"
                    />
                    <ThemeCard
                      label="Compact"
                      active={settings.chatTheme === 'compact'}
                      onClick={() => patch({ chatTheme: 'compact' })}
                      preview="compact"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function ThemeCard({
  label,
  active,
  onClick,
  preview,
}: {
  label: string
  active: boolean
  onClick: () => void
  preview: 'modern' | 'compact'
}) {
  const theme = useTheme()
  return (
    <div
      testId={`theme-${preview}`}
      onClick={onClick}
      style={{
        flexGrow: 1,
        backgroundColor: active ? 'rgba(167, 139, 250, 0.1)' : theme.fill,
        borderWidth: 1,
        borderColor: active ? theme.accent.primary : theme.hairline,
        borderRadius: 10,
        paddingTop: 10,
        paddingBottom: 8,
        paddingLeft: 8,
        paddingRight: 8,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        hover: { backgroundColor: theme.fillHover },
      }}
    >
      {preview === 'modern' ? (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {[0, 1].map((row) => (
            <div key={row} style={{ display: 'flex', flexDirection: 'row', gap: 4 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: theme.scrollbar,
                  flexShrink: 0,
                  marginTop: 1,
                }}
              />
              <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div
                  style={{
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: 'rgba(167, 139, 250, 0.5)',
                    width: '40%',
                  }}
                />
                <div
                  style={{
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: theme.hairline,
                    width: '85%',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {[28, 28, 18].map((nameWidth, row) => (
            <div
              key={row}
              style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 3 }}
            >
              <div
                style={{
                  width: `${nameWidth}%`,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: 'rgba(167, 139, 250, 0.5)',
                  flexShrink: 0,
                }}
              />
              <div
                style={{
                  width: 3,
                  height: 3,
                  borderRadius: 1,
                  backgroundColor: theme.scrollbar,
                  flexShrink: 0,
                }}
              />
              <div
                style={{
                  flexGrow: 1,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: theme.hairline,
                }}
              />
            </div>
          ))}
        </div>
      )}
      <Text style={{ fontSize: 11, fontWeight: 500, color: active ? theme.link : theme.text2 }}>
        {label}
      </Text>
    </div>
  )
}
