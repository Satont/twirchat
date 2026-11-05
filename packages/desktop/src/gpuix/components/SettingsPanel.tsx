import { useGpuixRequired, useWindowSize, type PublicInstance } from '@gpuix/react'
import { OVERLAY_SERVER_PORT } from '@twirchat/shared/constants'
import type { AppSettings, HotkeySettings, SelfPingConfig } from '@twirchat/shared/types'
/**
 * Settings panel — port of SettingsPanel.vue: appearance (theme + font),
 * self-ping highlight, updates, OBS overlay, and keyboard shortcuts.
 *
 * Local edits apply live by pushing straight into settingsStore (the Vue
 * `change` emit → App.settings); "Save changes" persists through
 * backend.api.saveSettings and flashes the "Saved!" check for 2s.
 */
import { DEFAULT_SETTINGS } from '@twirchat/shared/types'
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, useId } from 'react'
import type { ComponentType, ReactNode } from 'react'

import { useBackend } from '../backend/context'
import { focusPopupSearch } from '../hooks/use-popup-hotkeys'
import { nativeWindow } from '../native-window'
import {
  SETTINGS_SECTIONS,
  SETTINGS_SAVE_LABELS,
  searchSettings,
  resolveSettingsCategory,
  visibleSettingsSections,
  retainMountedSettingsSections,
  stepSettingsCategory,
  type SettingsCategoryId,
  type SettingsSectionId,
} from '../settings-search'
import { useHotkeyContext, useHotkeyRoute } from '../state/action-bindings'
import { settingsStore } from '../state/app'
import { useStore } from '../state/create-store'
import { useTextInputFocusTracking } from '../state/focus'
import { formatKeyCombo, GPUIX_TO_DOM_KEY } from '../state/hotkeys'
import { useOverlayClose } from '../state/overlays'
import { accent } from '../theme'
import { useTheme } from '../theme-context'
import { ChatLoggingSettings } from './ChatLoggingSettings'
import { ChatPauseSettings } from './ChatPauseSettings'
import { ChatRulesSettings } from './ChatRulesSettings'
import { CustomCommandsSettings } from './CustomCommandsSettings'
import { EmoteProviderSettings } from './EmoteProviderSettings'
import { HotkeySettings as ActionHotkeySettings } from './HotkeySettings'
import { ImageUploaderSettings } from './ImageUploaderSettings'
import { NotificationSettings } from './NotificationSettings'
import { PlayerSettings } from './PlayerSettings'
import { PluginSettings } from './PluginSettings'
import { SimilaritySettings } from './SimilaritySettings'
import { StreamerModeSettings } from './StreamerModeSettings'
import { TranslationSettings } from './TranslationSettings'
import { TwitchSessionSettings } from './TwitchSessionSettings'
import { ActionButton } from './ui/Form'
import { Icon } from './ui/Icon'
import { Slider } from './ui/Slider'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'
import { ModerationSettings } from './user-card/ModerationSettings'

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

const SectionVisibilityContext = createContext<{
  visible: ReadonlySet<SettingsSectionId>
  mounted: ReadonlySet<SettingsSectionId>
  narrow: boolean
}>({ visible: new Set(), mounted: new Set(), narrow: false })

const RetainedSettingsEditor = memo(function RetainedSettingsEditor({
  component: Editor,
}: {
  component: ComponentType
}) {
  return <Editor />
})

export function SettingsPanel() {
  const theme = useTheme()
  const backend = useBackend()
  const settings = useStore(settingsStore)
  const renderer = useGpuixRequired()
  const windowSize = useWindowSize()
  const narrow = windowSize.width < 900
  const sliderWidth = narrow ? Math.max(80, Math.min(200, windowSize.width - 220)) : 200
  const [category, setCategory] = useState<SettingsCategoryId>('general')
  const [query, setQuery] = useState('')
  const searchRef = useRef<PublicInstance | null>(null)
  const contentRef = useRef<PublicInstance | null>(null)
  const navRefs = useRef(new Map<SettingsCategoryId, number>())
  const searchFocus = useTextInputFocusTracking()
  const popupId = `popup:settings:${useId()}`
  useHotkeyContext({
    id: popupId,
    category: 'popupWindow',
    handlers: { search: () => focusPopupSearch(nativeWindow(renderer), searchRef) },
  })
  useHotkeyRoute([popupId, 'window'], true, 2)
  const search = useMemo(() => searchSettings(query), [query])
  const selectedCategory = resolveSettingsCategory(category, search)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (contentRef.current) renderer.scrollTo?.(contentRef.current.id, 0, 0)
    }, 0)
    return () => clearTimeout(timer)
  }, [selectedCategory, query, renderer])
  const visibleIds = useMemo(
    () => visibleSettingsSections(selectedCategory, search),
    [selectedCategory, search],
  )
  const [visitedIds, setVisitedIds] = useState<ReadonlySet<SettingsSectionId>>(new Set())
  const mountedIds = useMemo(
    () => retainMountedSettingsSections(visitedIds, visibleIds),
    [visitedIds, visibleIds],
  )
  const visibility = useMemo(
    () => ({ visible: new Set(visibleIds), mounted: mountedIds, narrow }),
    [visibleIds, mountedIds, narrow],
  )
  useEffect(() => {
    if (mountedIds !== visitedIds) setVisitedIds(mountedIds)
  }, [mountedIds, visitedIds])
  const selectCategory = (id: SettingsCategoryId) => {
    const element = navRefs.current.get(id)
    if (element !== undefined) renderer.focusElement?.(element)
    setCategory(id)
  }
  const clearQuery = () => {
    setQuery('')
    if (searchRef.current) renderer.focusElement?.(searchRef.current.id)
  }

  const [local, setLocal] = useState<EditableSettings>(() =>
    makeLocal(settings ?? DEFAULT_SETTINGS),
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [baselineLoaded, setBaselineLoaded] = useState(false)
  const [actionError, setActionError] = useState('')
  const [savedFingerprint, setSavedFingerprint] = useState(() =>
    JSON.stringify(makeLocal(settings ?? DEFAULT_SETTINGS)),
  )
  const localRef = useRef(local)
  localRef.current = local
  const savingRef = useRef(false)
  const baselineRevision = useRef(0)
  const ownPreview = useRef<AppSettings | null>(null)
  const dirty = JSON.stringify(local) !== savedFingerprint
  const [recordingAction, setRecordingAction] = useState<keyof HotkeySettings | null>(null)
  useOverlayClose(recordingAction !== null, () => setRecordingAction(null))
  const [appVersion, setAppVersion] = useState('…')

  useEffect(() => {
    if (selectedCategory !== 'general' || appVersion !== '…') return
    let active = true
    void backend.api
      .getAppVersion()
      .then((version) => {
        if (active) setAppVersion(version)
      })
      .catch(() => {
        if (active) setAppVersion('Unavailable')
      })
    return () => {
      active = false
    }
  }, [backend, selectedCategory, appVersion])

  useEffect(() => {
    let active = true
    const revision = baselineRevision.current
    void backend.api
      .getSettings()
      .then((persisted) => {
        if (!active) return
        if (revision === baselineRevision.current)
          setSavedFingerprint(JSON.stringify(makeLocal(persisted)))
        setBaselineLoaded(true)
      })
      .catch((error) => {
        if (active)
          setActionError(
            `Could not read saved app settings: ${String(error)}. You can still save your current edits.`,
          )
      })
    return () => {
      active = false
    }
  }, [backend])

  // Feedback-loop guard (Vue ignorePropSync): our own live-preview pushes into
  // the store must not reset local, external store changes do.
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!settings || settings === ownPreview.current) return
    const next = makeLocal(settings)
    localRef.current = next
    setLocal(next)
    setSavedFingerprint(JSON.stringify(next))
  }, [settings])

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  /** App settings preview immediately; only a successful save advances the durable baseline. */
  const patch = (mutate: (draft: EditableSettings) => void) => {
    const draft = makeLocal(localRef.current)
    mutate(draft)
    localRef.current = draft
    setLocal(draft)
    setSaved(false)
    const preview = makeLocal(draft)
    ownPreview.current = preview
    settingsStore.set(preview)
  }

  const save = async () => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setSaveError('')
    const snapshot = makeLocal(localRef.current)
    const fingerprint = JSON.stringify(snapshot)
    try {
      await backend.api.saveSettings(snapshot)
      baselineRevision.current++
      setSavedFingerprint(fingerprint)
      setBaselineLoaded(true)
      setSaved(JSON.stringify(localRef.current) === fingerprint)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      savingRef.current = false
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
    return `http://localhost:${OVERLAY_SERVER_PORT}/?${query}`
  }, [local.overlay])

  const copyOverlayUrl = () => {
    setActionError('')
    void backend.api.copyText({ text: overlayUrl }).catch((error) => {
      setActionError(`Could not copy the overlay URL: ${String(error)}`)
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
          flexShrink: 0,
          padding: narrow ? 16 : 24,
          paddingBottom: 16,
          borderBottomWidth: 1,
          borderColor: theme.border,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1, minWidth: 160 }}
          >
            <Text style={{ fontSize: 20, fontWeight: 700, color: theme.text }}>Settings</Text>
            <Text style={{ fontSize: 12, color: theme.text2 }}>
              Find an option or choose a category.
            </Text>
          </div>
          <ActionButton
            testId="settings-save"
            primary
            disabled={saving || (baselineLoaded && !dirty && !saveError)}
            onClick={() => void save()}
          >
            {saving
              ? 'Saving…'
              : saveError
                ? 'Retry saving app settings'
                : saved
                  ? 'App settings saved'
                  : 'Save app settings'}
          </ActionButton>
        </div>
        <Text style={{ fontSize: 11, color: dirty ? theme.text : theme.text2 }}>
          {`${dirty ? 'Unsaved app settings · ' : ''}Appearance, self-ping, updates and OBS use Save app settings. Each feature section describes how it saves.`}
        </Text>
        {saveError ? (
          <Text testId="settings-save-error" style={{ color: theme.dangerText, fontSize: 12 }}>
            {`${saveError} · Your edits are retained. Retry saving above.`}
          </Text>
        ) : null}
        {actionError ? (
          <Text style={{ color: theme.dangerText, fontSize: 12 }}>{actionError}</Text>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="search" size={15} color={theme.text2} />
          <input
            ref={searchRef}
            testId="settings-search"
            value={query}
            placeholder="Search all settings…"
            {...searchFocus}
            onChange={(event) => setQuery(event.value ?? '')}
            onKeyDown={(event) => {
              if (event.key === 'escape' && query) {
                event.preventDefault()
                clearQuery()
              }
              if ((event.key === 'down' || event.key === 'enter') && selectedCategory) {
                event.preventDefault()
                selectCategory(selectedCategory)
              }
            }}
            theme={{ caret: accent.primary }}
            style={{
              flexGrow: 1,
              minWidth: 0,
              padding: 8,
              color: theme.text,
              fontSize: 13,
              backgroundColor: theme.surface2,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          />
          {query ? (
            <ActionButton testId="settings-search-clear" onClick={clearQuery}>
              Clear
            </ActionButton>
          ) : null}
        </div>
      </div>
      <div
        style={{
          flexGrow: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: narrow ? 'column' : 'row',
        }}
      >
        <div
          testId="settings-categories"
          style={{
            width: narrow ? '100%' : 190,
            flexShrink: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: narrow ? 'row' : 'column',
            flexWrap: narrow ? 'wrap' : 'nowrap',
            gap: 4,
            padding: narrow ? 10 : 16,
            overflowY: narrow ? 'visible' : 'scroll',
            borderBottomWidth: narrow ? 1 : 0,
            borderRightWidth: narrow ? 0 : 1,
            borderColor: theme.border,
          }}
        >
          {search.categories.map((item) => {
            const active = item.id === selectedCategory
            const count = search.sections.filter((section) => section.category === item.id).length
            return (
              <div
                key={item.id}
                ref={(element) => {
                  if (element) navRefs.current.set(item.id, element.id)
                  else navRefs.current.delete(item.id)
                }}
                testId={`settings-category-${item.id}`}
                tabIndex={0}
                onClick={() => selectCategory(item.id)}
                onKeyDown={(event) => {
                  if (event.key === 'enter' || event.key === 'space') {
                    event.preventDefault()
                    selectCategory(item.id)
                  } else if (['up', 'left', 'down', 'right'].includes(event.key ?? '')) {
                    event.preventDefault()
                    const next = stepSettingsCategory(
                      search.categories.map((entry) => entry.id),
                      item.id,
                      event.key === 'up' || event.key === 'left' ? -1 : 1,
                    )
                    if (next) selectCategory(next)
                  } else if (event.key === 'home' || event.key === 'end') {
                    event.preventDefault()
                    const next =
                      event.key === 'home' ? search.categories[0] : search.categories.at(-1)
                    if (next) selectCategory(next.id)
                  }
                }}
                style={{
                  padding: narrow ? 8 : 10,
                  borderRadius: 7,
                  cursor: 'pointer',
                  backgroundColor: active ? accent.tint12 : undefined,
                  borderWidth: 1,
                  borderColor: active ? accent.tint25 : 'transparent',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  hover: { backgroundColor: active ? accent.tint12 : theme.fillHover },
                }}
              >
                <Text
                  style={{
                    color: active ? accent.primary : theme.text,
                    fontSize: 12,
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  {`${item.label}${query ? ` (${count})` : ''}`}
                </Text>
                {!narrow ? (
                  <Text style={{ color: theme.text2, fontSize: 10 }}>{item.description}</Text>
                ) : null}
              </div>
            )
          })}
        </div>
        <div
          testId="settings-content"
          ref={contentRef}
          style={{
            flexGrow: 1,
            minWidth: 0,
            minHeight: 0,
            overflowY: 'scroll',
            scrollbarColor: theme.scrollbar,
            scrollbarWidth: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 760,
              padding: narrow ? 12 : 24,
              paddingBottom: 48,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {!search.sections.length ? (
              <div
                testId="settings-search-empty"
                style={{
                  padding: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 12,
                }}
              >
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: 600 }}>
                  No settings found
                </Text>
                <Text style={{ color: theme.text2, fontSize: 12 }}>
                  Try a field name, provider, or a shorter phrase.
                </Text>
                <ActionButton onClick={clearQuery}>Clear search</ActionButton>
              </div>
            ) : null}
            <SectionVisibilityContext.Provider value={visibility}>
              {/* Appearance */}
              <Section id="appearance" title="Appearance">
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

              <Section
                id="commands"
                title="Custom Commands"
                desc="Create reusable commands and message actions"
              >
                <RetainedSettingsEditor component={CustomCommandsSettings} />
              </Section>
              <Section
                id="players"
                title="Stream Players"
                desc="Open streams in a browser, external player or Streamlink"
              >
                <RetainedSettingsEditor component={PlayerSettings} />
              </Section>
              <Section id="plugins" title="Plugins">
                <RetainedSettingsEditor component={PluginSettings} />
              </Section>
              <Section
                id="streamer-mode"
                title="Streamer Mode"
                desc="Protect private details while streaming"
              >
                <RetainedSettingsEditor component={StreamerModeSettings} />
              </Section>
              <Section
                id="similarity"
                title="Similar Messages"
                desc="Control repeated and almost identical messages"
              >
                <RetainedSettingsEditor component={SimilaritySettings} />
              </Section>
              <Section
                id="pause"
                title="Chat Pausing"
                desc="Keep chat still while reading or opening links"
              >
                <RetainedSettingsEditor component={ChatPauseSettings} />
              </Section>
              <Section id="twitch-session" title="Additional Twitch Session">
                <RetainedSettingsEditor component={TwitchSessionSettings} />
              </Section>
              <Section
                id="notifications"
                title="Notifications"
                desc="Choose sounds and desktop alerts for your highlight rules"
              >
                <RetainedSettingsEditor component={NotificationSettings} />
              </Section>
              <Section
                id="rules"
                title="Highlights, Ignores & Filters"
                desc="Control what appears in each chat and which messages need your attention"
              >
                <RetainedSettingsEditor component={ChatRulesSettings} />
              </Section>

              <Section id="emotes" title="Emotes & Cosmetics">
                <RetainedSettingsEditor component={EmoteProviderSettings} />
              </Section>
              <Section id="history" title="History & Logging">
                <RetainedSettingsEditor component={ChatLoggingSettings} />
              </Section>
              <Section id="image-uploader" title="Image Uploader">
                <RetainedSettingsEditor component={ImageUploaderSettings} />
              </Section>
              <Section id="translation" title="Translation">
                <RetainedSettingsEditor component={TranslationSettings} />
              </Section>
              <Section id="moderation" title="Moderation">
                <RetainedSettingsEditor component={ModerationSettings} />
              </Section>

              {/* Self-Ping Highlight */}
              <Section
                id="self-ping"
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
                  <div
                    style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}
                  >
                    <SmallInput
                      width={210}
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
                      minWidth: 0,
                      maxWidth: '100%',
                      flexWrap: 'wrap',
                      backgroundColor: local.selfPing.enabled ? local.selfPing.color : undefined,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: accent.primary,
                        flexShrink: 0,
                      }}
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
              <Section id="updates" title="Updates" desc="Automatic update settings">
                <FormRow first label="Version" hint="Currently installed version">
                  <Text style={{ fontSize: 13, color: theme.text2 }}>{appVersion}</Text>
                </FormRow>
                <FormRow label="Check now" hint="Look for updates on the release feed">
                  <div
                    onClick={() => {
                      setActionError('')
                      void backend.api
                        .checkForUpdate()
                        .catch((error) =>
                          setActionError(`Could not check for updates: ${String(error)}`),
                        )
                    }}
                    style={{
                      paddingTop: 6,
                      paddingBottom: 6,
                      paddingLeft: 12,
                      paddingRight: 12,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: theme.border,
                      backgroundColor: theme.surface2,
                      cursor: 'pointer',
                    }}
                  >
                    <Text style={{ fontSize: 13, color: theme.text }}>Check for updates</Text>
                  </div>
                </FormRow>
                <FormRow last label="Auto-check for updates" hint="Check on app startup">
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
              <Section
                id="overlay"
                title="OBS Overlay"
                desc="Add a Browser Source in OBS with the URL below"
              >
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
                  <div
                    style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}
                  >
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
                  <div
                    style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}
                  >
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
                      width={sliderWidth}
                      onChange={(value) =>
                        patch((draft) => {
                          draft.overlay.fontSize = value
                        })
                      }
                    />
                    <Text
                      style={{ fontSize: 12, color: theme.text2, width: 36, textAlign: 'right' }}
                    >
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
                      width={sliderWidth}
                      onChange={(value) =>
                        patch((draft) => {
                          draft.overlay.maxMessages = value
                        })
                      }
                    />
                    <Text
                      style={{ fontSize: 12, color: theme.text2, width: 36, textAlign: 'right' }}
                    >
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
              <Section id="shortcuts" title="Keyboard Shortcuts">
                <ActionHotkeySettings />
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
                          <Text
                            style={{ fontSize: 12, color: accent.primary, whiteSpace: 'nowrap' }}
                          >
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
            </SectionVisibilityContext.Provider>
          </div>
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
              event.preventDefault()
              event.stopPropagation()
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
function Section({
  id,
  title,
  desc,
  children,
}: {
  id: SettingsSectionId
  title: string
  desc?: string
  children: ReactNode
}) {
  const theme = useTheme()
  const visibility = useContext(SectionVisibilityContext)
  if (!visibility.mounted.has(id)) return null
  const visible = visibility.visible.has(id)
  const metadata = SETTINGS_SECTIONS.find((section) => section.id === id)!
  return (
    <div
      testId={`settings-section-${id}`}
      style={{
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 14,
        paddingTop: 20,
        paddingBottom: 20,
        paddingLeft: visibility.narrow ? 14 : 20,
        paddingRight: visibility.narrow ? 14 : 20,
        display: visible ? 'flex' : 'none',
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
      <Text style={{ fontSize: 10, color: theme.text2, marginBottom: 14 }}>
        {SETTINGS_SAVE_LABELS[metadata.saveMode]}
      </Text>
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
  const { narrow } = useContext(SectionVisibilityContext)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: narrow ? 'column' : 'row',
        alignItems: narrow ? 'stretch' : alignTop ? 'flex-start' : 'center',
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
        flexWrap: 'wrap',
        maxWidth: '100%',
        minWidth: 0,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 8,
        overflow: 'hidden',
        flexShrink: 1,
      }}
    >
      {options.map((option, index) => {
        const active = option.value === value
        return (
          <div
            key={option.value}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'enter' || event.key === 'space') {
                event.preventDefault()
                onChange(option.value)
              }
            }}
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
  width = 160,
  onChange,
}: {
  value: string
  placeholder?: string
  width?: number
  onChange: (value: string) => void
}) {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  const focusTracking = useTextInputFocusTracking(setFocused)
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.value ?? '')}
      {...focusTracking}
      theme={{ caret: accent.primary }}
      style={{
        width,
        maxWidth: '100%',
        minWidth: 0,
        flexShrink: 1,
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
