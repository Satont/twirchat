/**
 * Settings panel — port of SettingsPanel.vue: appearance (theme + font),
 * self-ping highlight, updates, OBS overlay, and keyboard shortcuts.
 *
 * Local edits apply live by pushing straight into settingsStore (the Vue
 * `change` emit → App.settings); "Save changes" persists through
 * backend.api.saveSettings and flashes the "Saved!" check for 2s.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppSettings, HotkeySettings, SelfPingConfig } from '@twirchat/shared/types'
import { DEFAULT_SETTINGS } from '@twirchat/shared/types'

import { useBackend } from '../backend/context'
import { useStore } from '../state/create-store'
import { settingsStore } from '../state/app'
import { accent } from '../theme'
import { useTheme } from '../theme-context'
import { Icon } from './ui/Icon'
import { Switch } from './ui/Switch'
import { Slider } from './ui/Slider'
import { Text } from './ui/Text'

/** AppSettings with the optional selfPing block materialized (Vue makeLocal). */
type EditableSettings = AppSettings & { selfPing: SelfPingConfig }

function makeLocal(s: AppSettings): EditableSettings {
  return {
    ...s,
    overlay: { ...s.overlay },
    selfPing: { ...(s.selfPing ?? DEFAULT_SETTINGS.selfPing!) },
    hotkeys: { ...(s.hotkeys ?? DEFAULT_SETTINGS.hotkeys) },
  }
}

const HOTKEYS_CONFIG: { action: keyof HotkeySettings; label: string; description: string }[] = [
  { action: 'newTab', label: 'Open new tab', description: 'Add a watched channel tab' },
  { action: 'nextTab', label: 'Next tab', description: 'Cycle to the next tab' },
  { action: 'prevTab', label: 'Previous tab', description: 'Cycle to the previous tab' },
  {
    action: 'tabSelector',
    label: 'Tab selector',
    description: 'Open fuzzy tab search (Ctrl+K always works)',
  },
]

function formatKeyCombo(combo: string): string {
  return combo
    .split('+')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('+')
}

/** GPUIX arrow names → DOM names, so recorded combos match the stored format. */
const GPUIX_TO_DOM_KEY: Record<string, string> = {
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
}

/** Modifier-only presses are skipped while recording (wait for the real key). */
const MODIFIER_ONLY_KEYS = new Set([
  'control',
  'ctrl',
  'shift',
  'alt',
  'meta',
  'cmd',
  'super',
  'fn',
  'capslock',
])

export function SettingsPanel() {
  const theme = useTheme()
  const backend = useBackend()
  const settings = useStore(settingsStore)

  const [local, setLocal] = useState<EditableSettings>(() =>
    makeLocal(settings ?? DEFAULT_SETTINGS),
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [recordingAction, setRecordingAction] = useState<keyof HotkeySettings | null>(null)

  // Feedback-loop guard (Vue ignorePropSync): our own live-preview pushes into
  // the store must not reset local, external store changes do.
  const ignoreStoreSync = useRef(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (ignoreStoreSync.current) {
      ignoreStoreSync.current = false
      return
    }
    if (settings) setLocal(makeLocal(settings))
  }, [settings])

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  /** Apply a local edit and push it live (the Vue `change` emit). */
  const patch = (mutate: (draft: EditableSettings) => void) => {
    const draft = makeLocal(local)
    mutate(draft)
    ignoreStoreSync.current = true
    setLocal(draft)
    settingsStore.set(makeLocal(draft))
  }

  const save = async () => {
    setSaving(true)
    try {
      await backend.api.saveSettings(makeLocal(local))
      // The Vue `saved` emit — App replaces settings with the persisted copy.
      ignoreStoreSync.current = true
      settingsStore.set(makeLocal(local))
      setSaved(true)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      console.warn('[settings] saveSettings failed:', error)
    } finally {
      setSaving(false)
    }
  }

  // URLSearchParams is a Web API and is not available in the GPUIX runtime;
  // these values are simple enough for encodeURIComponent to match its output.
  const overlayUrl = useMemo(() => {
    const p = local.overlay
    const params: [string, string][] = [
      ['animation', p.animation],
      ['bg', p.background],
      ['color', p.textColor],
      ['fontSize', String(p.fontSize)],
      ['maxMessages', String(p.maxMessages)],
      ['position', p.position],
    ]
    const query = params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')
    return `http://localhost:${p.port}/?${query}`
  }, [local.overlay])

  const copyOverlayUrl = () => {
    void backend.api.copyText({ text: overlayUrl }).catch((error) => {
      console.warn('[settings] copyText failed:', error)
    })
  }

  const finishRecording = (combo: string | null) => {
    const action = recordingAction
    setRecordingAction(null)
    if (combo === null || action === null) return
    patch((draft) => {
      draft.hotkeys[action] = combo
    })
  }

  return (
    <div
      style={{
        flexGrow: 1,
        minHeight: 0,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.bg,
      }}
    >
      <div
        style={{
          flexGrow: 1,
          minHeight: 0,
          overflowY: 'scroll',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 640,
            paddingTop: 28,
            paddingBottom: 60,
            paddingLeft: 32,
            paddingRight: 32,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Text style={{ fontSize: 20, fontWeight: 700, color: theme.text }}>Settings</Text>
              <Text style={{ fontSize: 13, color: theme.text2, marginTop: 3 }}>
                Customize appearance and overlay options
              </Text>
            </div>
            <div
              testId="settings-save"
              onClick={() => {
                if (!saving) void save()
              }}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: accent.primary,
                borderRadius: 8,
                paddingTop: 8,
                paddingBottom: 8,
                paddingLeft: 18,
                paddingRight: 18,
                cursor: saving ? 'default' : 'pointer',
                opacity: saving ? 0.5 : 1,
                flexShrink: 0,
                ...(saving ? {} : { hover: { opacity: 0.88 } }),
              }}
            >
              {saved ? <Icon name="check" size={14} color="#ffffff" /> : null}
              <Text
                style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', whiteSpace: 'nowrap' }}
              >
                {saved ? 'Saved!' : saving ? 'Saving…' : 'Save changes'}
              </Text>
            </div>
          </div>

          {/* Appearance */}
          <Section title="Appearance">
            <FormRow first label="Theme">
              <ToggleGroup
                value={local.theme}
                options={[
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ]}
                onChange={(value) =>
                  patch((draft) => {
                    draft.theme = value
                  })
                }
              />
            </FormRow>
            <FormRow last label="Font">
              <ToggleGroup
                value={local.fontFamily}
                options={[
                  { value: 'inter', label: 'Inter' },
                  { value: 'manrope', label: 'Manrope' },
                  { value: 'system', label: 'System' },
                ]}
                onChange={(value) =>
                  patch((draft) => {
                    draft.fontFamily = value
                  })
                }
              />
            </FormRow>
          </Section>

          {/* Self-Ping Highlight */}
          <Section
            title="Self-Ping Highlight"
            desc="Highlight messages that mention your own nickname"
          >
            <FormRow first label="Enable highlights" hint="Highlight messages mentioning you">
              <Switch
                checked={local.selfPing.enabled}
                onChange={(value) =>
                  patch((draft) => {
                    draft.selfPing.enabled = value
                  })
                }
              />
            </FormRow>
            <FormRow label="Highlight color">
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <SmallInput
                  value={local.selfPing.color}
                  placeholder="rgba(167, 139, 250, 0.15)"
                  onChange={(value) =>
                    patch((draft) => {
                      draft.selfPing.color = value
                    })
                  }
                />
                <ColorSwatch color={local.selfPing.color} />
              </div>
            </FormRow>
            <FormRow last alignTop label="Preview" hint="How a pinged message looks">
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingTop: 6,
                  paddingBottom: 6,
                  paddingLeft: 12,
                  paddingRight: 12,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: theme.border,
                  minWidth: 200,
                  backgroundColor: local.selfPing.enabled ? local.selfPing.color : undefined,
                }}
              >
                <Text
                  style={{ fontSize: 13, fontWeight: 700, color: accent.primary, flexShrink: 0 }}
                >
                  StreamerName:
                </Text>
                <Text style={{ fontSize: 13, color: theme.text }}>Hey</Text>
                <Text style={{ fontSize: 13, fontWeight: 600, color: accent.primary }}>
                  @YourName
                </Text>
                <Text style={{ fontSize: 13, color: theme.text }}>what do you think?</Text>
              </div>
            </FormRow>
          </Section>

          {/* Updates */}
          <Section title="Updates" desc="Automatic update settings">
            <FormRow first last label="Auto-check for updates" hint="Check on app startup">
              <Switch
                checked={local.autoCheckUpdates ?? false}
                onChange={(value) =>
                  patch((draft) => {
                    draft.autoCheckUpdates = value
                  })
                }
              />
            </FormRow>
          </Section>

          {/* OBS Overlay */}
          <Section title="OBS Overlay" desc="Add a Browser Source in OBS with the URL below">
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                backgroundColor: theme.surface2,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 8,
                paddingTop: 10,
                paddingBottom: 10,
                paddingLeft: 14,
                paddingRight: 14,
                marginBottom: 16,
              }}
            >
              <Text
                style={{
                  flexGrow: 1,
                  minWidth: 0,
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: accent.primary,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {overlayUrl}
              </Text>
              <div
                testId="settings-copy-url"
                onClick={copyOverlayUrl}
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: accent.tint12,
                  borderWidth: 1,
                  borderColor: accent.tint25,
                  borderRadius: 8,
                  paddingTop: 5,
                  paddingBottom: 5,
                  paddingLeft: 10,
                  paddingRight: 10,
                  cursor: 'pointer',
                  flexShrink: 0,
                  hover: { backgroundColor: 'rgba(167, 139, 250, 0.22)' },
                }}
              >
                <Icon name="copy" size={14} color={accent.primary} />
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: accent.primary,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Copy
                </Text>
              </div>
            </div>

            <FormRow label="Port">
              <SmallInput
                value={String(local.overlay.port)}
                onChange={(value) => {
                  if (!/^\d+$/.test(value)) return
                  patch((draft) => {
                    draft.overlay.port = parseInt(value, 10)
                  })
                }}
              />
            </FormRow>

            <FormRow label="Background" hint='Use "transparent" for chroma key'>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <SmallInput
                  value={local.overlay.background}
                  placeholder="transparent"
                  onChange={(value) =>
                    patch((draft) => {
                      draft.overlay.background = value
                    })
                  }
                />
                {local.overlay.background !== 'transparent' ? (
                  <ColorSwatch color={local.overlay.background} />
                ) : null}
              </div>
            </FormRow>

            <FormRow label="Text colour">
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <SmallInput
                  value={local.overlay.textColor}
                  onChange={(value) =>
                    patch((draft) => {
                      draft.overlay.textColor = value
                    })
                  }
                />
                <ColorSwatch color={local.overlay.textColor} />
              </div>
            </FormRow>

            <FormRow label="Font size">
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  flexShrink: 0,
                }}
              >
                <Slider
                  value={local.overlay.fontSize}
                  min={11}
                  max={28}
                  width={200}
                  onChange={(value) =>
                    patch((draft) => {
                      draft.overlay.fontSize = value
                    })
                  }
                />
                <Text style={{ fontSize: 12, color: theme.text2, width: 36, textAlign: 'right' }}>
                  {`${local.overlay.fontSize}px`}
                </Text>
              </div>
            </FormRow>

            <FormRow label="Max messages">
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  flexShrink: 0,
                }}
              >
                <Slider
                  value={local.overlay.maxMessages}
                  min={1}
                  max={50}
                  width={200}
                  onChange={(value) =>
                    patch((draft) => {
                      draft.overlay.maxMessages = value
                    })
                  }
                />
                <Text style={{ fontSize: 12, color: theme.text2, width: 36, textAlign: 'right' }}>
                  {local.overlay.maxMessages}
                </Text>
              </div>
            </FormRow>

            <FormRow label="Animation">
              <ToggleGroup
                value={local.overlay.animation}
                options={[
                  { value: 'slide', label: 'Slide' },
                  { value: 'fade', label: 'Fade' },
                  { value: 'none', label: 'None' },
                ]}
                onChange={(value) =>
                  patch((draft) => {
                    draft.overlay.animation = value
                  })
                }
              />
            </FormRow>

            <FormRow label="Position">
              <ToggleGroup
                value={local.overlay.position}
                options={[
                  { value: 'bottom', label: 'Bottom' },
                  { value: 'top', label: 'Top' },
                ]}
                onChange={(value) =>
                  patch((draft) => {
                    draft.overlay.position = value
                  })
                }
              />
            </FormRow>

            <FormRow label="Show platform icon">
              <Switch
                checked={local.overlay.showPlatformIcon}
                onChange={(value) =>
                  patch((draft) => {
                    draft.overlay.showPlatformIcon = value
                  })
                }
              />
            </FormRow>

            <FormRow last label="Show avatars">
              <Switch
                checked={local.overlay.showAvatar}
                onChange={(value) =>
                  patch((draft) => {
                    draft.overlay.showAvatar = value
                  })
                }
              />
            </FormRow>
          </Section>

          {/* Keyboard Shortcuts */}
          <Section title="Keyboard Shortcuts">
            {HOTKEYS_CONFIG.map((config, index) => {
              const recording = recordingAction === config.action
              return (
                <FormRow
                  key={config.action}
                  first={index === 0}
                  last={index === HOTKEYS_CONFIG.length - 1}
                  label={config.label}
                  hint={config.description}
                >
                  <div
                    onClick={() => setRecordingAction(config.action)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 100,
                      paddingTop: 4,
                      paddingBottom: 4,
                      paddingLeft: 10,
                      paddingRight: 10,
                      backgroundColor: recording ? accent.tint10 : theme.surface2,
                      borderWidth: 1,
                      borderColor: recording ? accent.primary : theme.border,
                      borderRadius: 6,
                      cursor: 'pointer',
                      flexShrink: 0,
                      ...(recording
                        ? {}
                        : { hover: { backgroundColor: 'rgba(255, 255, 255, 0.05)' } }),
                    }}
                  >
                    {recording ? (
                      <Text style={{ fontSize: 12, color: accent.primary, whiteSpace: 'nowrap' }}>
                        Press a key…
                      </Text>
                    ) : (
                      <Text
                        style={{
                          fontSize: 12,
                          fontFamily: 'monospace',
                          color: theme.text,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatKeyCombo(local.hotkeys[config.action])}
                      </Text>
                    )}
                  </div>
                </FormRow>
              )
            })}
          </Section>
        </div>
      </div>

      {/* Hotkey recording capture layer (replaces the Vue window keydown listener) */}
      {recordingAction !== null ? (
        <anchored
          deferred
          occlude
          position={{ x: 0, y: 0 }}
          style={{ width: '100%', height: '100%' }}
        >
          <div
            testId="hotkey-recording-capture"
            autoFocus
            tabIndex={0}
            onClick={() => finishRecording(null)}
            onKeyDown={(event) => {
              const rawKey = (event.key ?? '').toLowerCase()
              if (rawKey === 'escape') {
                finishRecording(null)
                return
              }
              if (rawKey === '' || MODIFIER_ONLY_KEYS.has(rawKey)) return
              const parts: string[] = []
              if (event.modifiers?.ctrl) parts.push('ctrl')
              if (event.modifiers?.shift) parts.push('shift')
              if (event.modifiers?.alt) parts.push('alt')
              parts.push(GPUIX_TO_DOM_KEY[rawKey] ?? rawKey)
              finishRecording(parts.join('+'))
            }}
            style={{
              width: '100%',
              height: '100%',
              pointerEvents: 'auto',
              backgroundColor: 'rgba(0, 0, 0, 0)',
            }}
          />
        </anchored>
      ) : null}
    </div>
  )
}

/** Section card — .settings-section + .section-title + optional .section-desc. */
function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  const theme = useTheme()
  return (
    <div
      style={{
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 14,
        paddingTop: 20,
        paddingBottom: 20,
        paddingLeft: 20,
        paddingRight: 20,
        display: 'flex',
        flexDirection: 'column',
        marginBottom: 8,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: 700, color: theme.text2, marginBottom: 14 }}>
        {title.toUpperCase()}
      </Text>
      {desc ? (
        <Text style={{ fontSize: 12, color: theme.text2, marginTop: -8, marginBottom: 14 }}>
          {desc}
        </Text>
      ) : null}
      {children}
    </div>
  )
}

/** Label + control row — .form-row / .form-label / .form-hint. */
function FormRow({
  first,
  last,
  alignTop,
  label,
  hint,
  children,
}: {
  first?: boolean
  last?: boolean
  alignTop?: boolean
  label: string
  hint?: string
  children: ReactNode
}) {
  const theme = useTheme()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: alignTop ? 'flex-start' : 'center',
        justifyContent: 'space-between',
        gap: 16,
        paddingTop: first ? 0 : alignTop ? 12 : 10,
        paddingBottom: last ? 0 : 10,
        borderBottomWidth: last ? 0 : 1,
        borderColor: theme.border,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Text style={{ fontSize: 14, fontWeight: 500, color: theme.text }}>{label}</Text>
        {hint ? (
          <Text style={{ fontSize: 11, fontWeight: 400, color: theme.text2 }}>{hint}</Text>
        ) : null}
      </div>
      {children}
    </div>
  )
}

/** Segmented toggle — .toggle-group / .toggle-btn (.active = accent tint). */
function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  const theme = useTheme()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 8,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {options.map((option, index) => {
        const active = option.value === value
        return (
          <div
            key={option.value}
            onClick={() => onChange(option.value)}
            style={{
              paddingTop: 5,
              paddingBottom: 5,
              paddingLeft: 12,
              paddingRight: 12,
              cursor: 'pointer',
              backgroundColor: active ? accent.tint20 : undefined,
              borderLeftWidth: index === 0 ? 0 : 1,
              borderColor: theme.border,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: active ? accent.primary : theme.text2,
              }}
            >
              {option.label}
            </Text>
          </div>
        )
      })}
    </div>
  )
}

/** .input-sm — focus border via onFocus/onBlur state (GPUIX has no :focus). */
function SmallInput({
  value,
  placeholder,
  onChange,
}: {
  value: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.value ?? '')}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      theme={{ caret: accent.primary }}
      style={{
        width: 160,
        backgroundColor: theme.surface2,
        borderWidth: 1,
        borderColor: focused ? accent.primary : theme.border,
        borderRadius: 6,
        color: theme.text,
        fontSize: 13,
        paddingTop: 5,
        paddingBottom: 5,
        paddingLeft: 10,
        paddingRight: 10,
      }}
    />
  )
}

/**
 * .color-swatch approximation — GPUIX has no native color-picker input, so
 * this is display-only. The border is an addition: without the native input
 * chrome a transparent or low-alpha swatch would be invisible on the card.
 */
function ColorSwatch({ color }: { color: string }) {
  const theme = useTheme()
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: 6,
        backgroundColor: color,
        borderWidth: 1,
        borderColor: theme.border,
        flexShrink: 0,
      }}
    />
  )
}
