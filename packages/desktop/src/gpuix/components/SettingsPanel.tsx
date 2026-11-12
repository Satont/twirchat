import { useGpuixRequired, useWindowSize, type PublicInstance } from '@gpuix/react'
import { OVERLAY_SERVER_PORT } from '@twirchat/shared/constants'
import type {
  AppSettings,
  CustomPalette,
  HotkeySettings,
  SelfPingConfig,
} from '@twirchat/shared/types'
/**
 * Settings panel — appearance, chat features, overlay and shortcuts.
 *
 * One Save footer owns every mounted section: app-settings fields persist
 * through saveSettings and feature sections register their draft save/discard
 * callbacks. Dirty sections are marked in the header and category navigation,
 * and leaving the panel with drafts triggers a save/discard warning.
 */
import { DEFAULT_SETTINGS } from '@twirchat/shared/types'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ComponentType } from 'react'

import { useBackend } from '../backend/context'
import { focusPopupSearch } from '../hooks/use-popup-hotkeys'
import { setLanguage, useT, type MessageKey } from '../i18n'
import { nativeWindow } from '../native-window'
import {
  searchSettings,
  resolveSettingsCategory,
  settingsCategoryDescription,
  settingsCategoryLabel,
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
import { bindSettingsSession, syncSettingsSession } from '../state/settings-session'
import { DEFAULT_CUSTOM_PALETTE, normalizePaletteColor, resolvePresetPalette } from '../theme'
import { useTheme } from '../theme-context'
import { ChatLoggingSettings } from './chat-settings/ChatLoggingSettings'
import { ChatPauseSettings } from './chat-settings/ChatPauseSettings'
import { ChatRulesSettings } from './chat-settings/ChatRulesSettings'
import { ChatTimestampFormatSettings } from './chat-settings/ChatTimestampFormatSettings'
import { CustomCommandsSettings } from './CustomCommandsSettings'
import { DonationSettings } from './DonationSettings'
import { EmoteProviderSettings } from './EmoteProviderSettings'
import { HotkeySettings as ActionHotkeySettings } from './HotkeySettings'
import { ImageUploaderSettings } from './ImageUploaderSettings'
import { NotificationSettings } from './NotificationSettings'
import { PlayerSettings } from './PlayerSettings'
import { PluginSettings } from './PluginSettings'
import {
  SettingsDirtyReporterContext,
  SettingsFooter,
  SettingsRow,
  SettingsRowControl,
  SettingsSaveRegistryContext,
  SettingsSection,
  SettingsSectionContext,
  type SettingsSectionController,
} from './settings/SettingsLayout'
import { SettingsLeaveDialog } from './settings/SettingsLeaveDialog'
import { SimilaritySettings } from './SimilaritySettings'
import { StreamerModeSettings } from './StreamerModeSettings'
import { ThemeSettings, type PaletteInputs } from './ThemeSettings'
import { TranslationSettings } from './TranslationSettings'
import { TwitchSessionSettings } from './TwitchSessionSettings'
import { ActionButton } from './ui/Form'
import { Icon } from './ui/Icon'
import { Slider } from './ui/Slider'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'
import { ToggleGroup } from './ui/ToggleGroup'
import { ModerationSettings } from './user-card-dialog/ModerationSettings'

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

/** Sections that persist through the shared app-settings document. */
type AppSettingsSectionId = Extract<
  SettingsSectionId,
  | 'appearance'
  | 'updates'
  | 'timestamps'
  | 'replies'
  | 'self-ping'
  | 'overlay'
  | 'shortcuts'
  | 'twir-integration'
  | 'jeetbot-integration'
  | 'fossabot-integration'
  | 'nightbot-integration'
  | 'potat-integration'
  | 'supibot-integration'
  | 'moderation'
>

const APP_SETTINGS_SECTIONS: readonly AppSettingsSectionId[] = [
  'appearance',
  'updates',
  'timestamps',
  'replies',
  'self-ping',
  'overlay',
  'shortcuts',
  'twir-integration',
  'jeetbot-integration',
  'fossabot-integration',
  'nightbot-integration',
  'potat-integration',
  'supibot-integration',
  'moderation',
]

function appSectionFields(
  section: AppSettingsSectionId,
  source: EditableSettings,
): Partial<EditableSettings> {
  switch (section) {
    case 'appearance':
      return {
        language: source.language,
        theme: source.theme,
        themeMode: source.themeMode,
        customPalette: source.customPalette,
        fontFamily: source.fontFamily,
      }
    case 'updates':
      return { autoCheckUpdates: source.autoCheckUpdates }
    case 'timestamps':
      return {
        showTimestamp: source.showTimestamp,
        timestampFormat: source.timestampFormat,
      }
    case 'replies':
      return { replyOnDoubleClick: source.replyOnDoubleClick }
    case 'self-ping':
      return { selfPing: { ...source.selfPing } }
    case 'overlay':
      return { overlay: { ...source.overlay } }
    case 'shortcuts':
      return { hotkeys: { ...source.hotkeys } }
    case 'twir-integration':
      return { twirIntegrationEnabled: source.twirIntegrationEnabled }
    case 'jeetbot-integration':
      return { jeetbotIntegrationEnabled: source.jeetbotIntegrationEnabled }
    case 'fossabot-integration':
      return { fossabotIntegrationEnabled: source.fossabotIntegrationEnabled }
    case 'nightbot-integration':
      return { nightbotIntegrationEnabled: source.nightbotIntegrationEnabled }
    case 'potat-integration':
      return { potatIntegrationEnabled: source.potatIntegrationEnabled }
    case 'supibot-integration':
      return { supibotIntegrationEnabled: source.supibotIntegrationEnabled }
    case 'moderation':
      return { showModerationRail: source.showModerationRail }
    default:
      return {}
  }
}

function appSectionDirty(
  section: AppSettingsSectionId,
  local: EditableSettings,
  persisted: EditableSettings,
): boolean {
  return (
    JSON.stringify(appSectionFields(section, local)) !==
    JSON.stringify(appSectionFields(section, persisted))
  )
}

function customPaletteFor(settings: AppSettings): CustomPalette {
  return (
    settings.customPalette ??
    resolvePresetPalette(settings.theme, settings.themeMode) ??
    DEFAULT_CUSTOM_PALETTE
  )
}

const HOTKEYS_CONFIG: {
  action: keyof HotkeySettings
  labelKey: MessageKey
  descriptionKey: MessageKey
}[] = [
  {
    action: 'newTab',
    labelKey: 'settings.shortcuts.newTab',
    descriptionKey: 'settings.shortcuts.newTabDesc',
  },
  {
    action: 'nextTab',
    labelKey: 'settings.shortcuts.nextTab',
    descriptionKey: 'settings.shortcuts.nextTabDesc',
  },
  {
    action: 'prevTab',
    labelKey: 'settings.shortcuts.prevTab',
    descriptionKey: 'settings.shortcuts.prevTabDesc',
  },
  {
    action: 'tabSelector',
    labelKey: 'settings.shortcuts.tabSelector',
    descriptionKey: 'settings.shortcuts.tabSelectorDesc',
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
  const { t, tPlural } = useT()
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
  const [baselineLoaded, setBaselineLoaded] = useState(false)
  const [actionError, setActionError] = useState('')
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [globalSaving, setGlobalSaving] = useState(false)
  const [paletteInputs, setPaletteInputs] = useState<PaletteInputs>({})
  const invalidPalette = Object.values(paletteInputs).some((input) => input.invalid)
  const [editorDirty, setEditorDirty] = useState<ReadonlySet<SettingsSectionId>>(new Set())
  const localRef = useRef(local)
  localRef.current = local
  const [persisted, setPersisted] = useState<EditableSettings>(() =>
    makeLocal(settings ?? DEFAULT_SETTINGS),
  )
  const persistedRef = useRef(persisted)
  persistedRef.current = persisted
  const globalSavingRef = useRef(false)
  const controllersRef = useRef(new Map<string, SettingsSectionController>())
  const saveRegistry = useMemo(
    () => ({
      register(key: string, controller: SettingsSectionController) {
        controllersRef.current.set(key, controller)
      },
      unregister(key: string) {
        controllersRef.current.delete(key)
      },
    }),
    [],
  )
  const baselineRevision = useRef(0)
  const ownPreview = useRef<AppSettings | null>(null)
  const [recordingAction, setRecordingAction] = useState<keyof HotkeySettings | null>(null)
  useOverlayClose(recordingAction !== null, () => setRecordingAction(null))
  const [appVersion, setAppVersion] = useState('…')

  const appDirty = useMemo(() => {
    const result = new Set<SettingsSectionId>()
    if (!baselineLoaded) return result
    for (const section of APP_SETTINGS_SECTIONS) {
      if (appSectionDirty(section, local, persisted)) result.add(section)
    }
    return result
  }, [baselineLoaded, local, persisted])

  const dirtySections = useMemo(() => {
    if (!editorDirty.size) return appDirty
    const result = new Set(appDirty)
    for (const id of editorDirty) result.add(id)
    return result
  }, [appDirty, editorDirty])

  const reportDirty = useCallback((id: SettingsSectionId, dirty: boolean) => {
    setEditorDirty((current) => {
      if (current.has(id) === dirty) return current
      const next = new Set(current)
      if (dirty) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const visibility = useMemo(
    () => ({
      visible: new Set(visibleIds),
      mounted: mountedIds,
      dirty: dirtySections,
      narrow,
      query,
    }),
    [visibleIds, mountedIds, dirtySections, narrow, query],
  )

  useEffect(() => {
    if (selectedCategory !== 'general' || appVersion !== '…') return
    let active = true
    void backend.api
      .getAppVersion()
      .then((version) => {
        if (active) setAppVersion(version)
      })
      .catch(() => {
        if (active) setAppVersion(t('common.unavailable'))
      })
    return () => {
      active = false
    }
  }, [backend, selectedCategory, appVersion, t])

  useEffect(() => {
    let active = true
    const revision = baselineRevision.current
    void backend.api
      .getSettings()
      .then((stored) => {
        if (!active) return
        if (revision === baselineRevision.current) {
          const next = makeLocal(stored)
          persistedRef.current = next
          setLanguage(next.language)
          setPersisted(() => next)
        }
        setBaselineLoaded(true)
      })
      .catch((error) => {
        if (active) setActionError(t('settings.error.read', { error: String(error) }))
      })
    return () => {
      active = false
    }
  }, [backend, t])

  // Feedback-loop guard (Vue ignorePropSync): our own live-preview pushes into
  // the store must not reset local, external store changes do.
  useEffect(() => {
    if (!settings || settings === ownPreview.current) return
    const next = makeLocal(settings)
    localRef.current = next
    setLanguage(next.language)
    setLocal(next)
    persistedRef.current = next
    setPersisted(next)
    setPaletteInputs({})
  }, [settings])

  /** App settings preview immediately; a section save advances only its persisted fields. */
  const patch = (mutate: (draft: EditableSettings) => void) => {
    const draft = makeLocal(localRef.current)
    mutate(draft)
    localRef.current = draft
    setLocal(draft)
    setLanguage(draft.language)
    const preview = makeLocal(draft)
    ownPreview.current = preview
    settingsStore.set(preview)
  }

  const saveAll = useCallback(async (): Promise<boolean> => {
    if (globalSavingRef.current || !baselineLoaded || invalidPalette) return false
    globalSavingRef.current = true
    setGlobalSaving(true)
    setSaveError('')
    let savedEverything = true
    try {
      if (appDirty.size) {
        const snapshot = makeLocal(localRef.current)
        try {
          await backend.api.saveSettings(snapshot)
          baselineRevision.current++
          persistedRef.current = snapshot
          setPersisted(snapshot)
          if (JSON.stringify(makeLocal(localRef.current)) !== JSON.stringify(snapshot))
            savedEverything = false
        } catch (error) {
          savedEverything = false
          setSaveError(error instanceof Error ? error.message : String(error))
        }
      }
      for (const controller of [...controllersRef.current.values()]) {
        if (!controller.dirty) continue
        if (!(await controller.save())) savedEverything = false
      }
    } finally {
      globalSavingRef.current = false
      setGlobalSaving(false)
    }
    if (!savedEverything) setSaveError((current) => current || t('settings.error.save'))
    return savedEverything
  }, [appDirty, backend, baselineLoaded, invalidPalette, t])

  const selectTheme = (value: AppSettings['theme']) => {
    const current = localRef.current
    if (value === current.theme) return
    setPaletteInputs({})
    patch((draft) => {
      if (value === 'custom') draft.customPalette = customPaletteFor(current)
      draft.theme = value
    })
  }

  const selectThemeMode = (mode: AppSettings['themeMode']) => {
    if (mode === localRef.current.themeMode) return
    patch((draft) => {
      draft.themeMode = mode
    })
  }

  const editPalette = (key: keyof CustomPalette, value: string) => {
    const color = normalizePaletteColor(value)
    setPaletteInputs((inputs) => ({ ...inputs, [key]: { value, invalid: color === null } }))
    if (color === null || color === localRef.current.customPalette?.[key]) return
    patch((draft) => {
      draft.customPalette = { ...(draft.customPalette ?? DEFAULT_CUSTOM_PALETTE), [key]: color }
    })
  }

  const resetPalette = () => {
    setPaletteInputs({})
    patch((draft) => {
      draft.customPalette = DEFAULT_CUSTOM_PALETTE
    })
  }

  const discardAll = useCallback(() => {
    const next = makeLocal(persistedRef.current)
    localRef.current = next
    setLocal(next)
    setLanguage(next.language)
    ownPreview.current = next
    settingsStore.set(next)
    setSaveError('')
    for (const controller of controllersRef.current.values()) {
      if (controller.dirty) controller.discard()
    }
  }, [])

  const saveAllRef = useRef(saveAll)
  saveAllRef.current = saveAll
  const discardAllRef = useRef(discardAll)
  discardAllRef.current = discardAll

  useEffect(
    () =>
      bindSettingsSession({
        save: () => saveAllRef.current(),
        discard: () => discardAllRef.current(),
      }),
    [],
  )

  useEffect(() => {
    syncSettingsSession(dirtySections.size > 0, globalSaving)
  }, [dirtySections.size, globalSaving])

  const appFooter = (section: AppSettingsSectionId) => (
    <SettingsFooter sectionId={section} dirty={appDirty.has(section)} saving={globalSaving} />
  )

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
      setActionError(t('settings.error.copyOverlayUrl', { error: String(error) }))
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
            <Text style={{ fontSize: 20, fontWeight: 700, color: theme.text }}>
              {t('settings.title')}
            </Text>
            <Text style={{ fontSize: 12, color: theme.text2 }}>{t('settings.subtitle')}</Text>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              flexShrink: 0,
            }}
          >
            {dirtySections.size ? (
              <ActionButton disabled={globalSaving} onClick={discardAll}>
                {t('common.discard')}
              </ActionButton>
            ) : null}
            <ActionButton
              testId="settings-save"
              primary
              disabled={!baselineLoaded || !dirtySections.size || globalSaving || invalidPalette}
              onClick={() => void saveAll()}
            >
              {globalSaving
                ? t('common.saving')
                : saveError
                  ? t('common.retrySave')
                  : t('common.saveChanges')}
            </ActionButton>
          </div>
        </div>
        <Text
          style={{
            fontSize: 11,
            color: dirtySections.size ? theme.accent.primary : theme.text2,
          }}
        >
          {invalidPalette
            ? t('settings.status.invalidPalette')
            : dirtySections.size
              ? tPlural('settings.status.unsaved', dirtySections.size)
              : t('settings.status.saved')}
        </Text>
        {saveError ? (
          <Text testId="settings-save-error" style={{ color: theme.dangerText, fontSize: 12 }}>
            {saveError}
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
            placeholder={t('settings.search.placeholder')}
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
            theme={{ caret: theme.accent.primary }}
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
              {t('settings.search.clear')}
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
            const categoryDirty = search.sections.some(
              (section) => section.category === item.id && dirtySections.has(section.id),
            )
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
                  backgroundColor: active ? theme.accent.tint12 : undefined,
                  borderWidth: 1,
                  borderColor: active ? theme.accent.tint25 : 'transparent',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  hover: { backgroundColor: active ? theme.accent.tint12 : theme.fillHover },
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Text
                    style={{
                      color: active ? theme.accent.primary : theme.text,
                      fontSize: 12,
                      fontWeight: active ? 700 : 500,
                    }}
                  >
                    {`${settingsCategoryLabel(item.id)}${query ? ` (${count})` : ''}`}
                  </Text>
                  {categoryDirty ? (
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: theme.accent.primary,
                        flexShrink: 0,
                      }}
                    />
                  ) : null}
                </div>
                {!narrow ? (
                  <Text style={{ color: theme.text2, fontSize: 10 }}>
                    {settingsCategoryDescription(item.id)}
                  </Text>
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
                  {t('settings.search.emptyTitle')}
                </Text>
                <Text style={{ color: theme.text2, fontSize: 12 }}>
                  {t('settings.search.emptyHint')}
                </Text>
                <ActionButton onClick={clearQuery}>{t('settings.search.clear')}</ActionButton>
              </div>
            ) : null}
            <SettingsSectionContext.Provider value={visibility}>
              <SettingsSaveRegistryContext.Provider value={saveRegistry}>
                <SettingsDirtyReporterContext.Provider value={reportDirty}>
                  {/* Appearance */}
                  <SettingsSection id="appearance" title={t('settings.section.appearance')}>
                    <SettingsRow
                      first
                      label={t('settings.appearance.language')}
                      hint={t('settings.appearance.languageHint')}
                    >
                      <SettingsRowControl>
                        <ToggleGroup
                          label={t('settings.appearance.language')}
                          value={local.language}
                          options={[
                            { value: 'en', label: t('common.language.en') },
                            { value: 'ru', label: t('common.language.ru') },
                          ]}
                          onChange={(value) =>
                            patch((draft) => {
                              draft.language = value
                            })
                          }
                        />
                      </SettingsRowControl>
                    </SettingsRow>
                    <SettingsRow label={t('settings.appearance.theme')}>
                      <ThemeSettings
                        value={local.theme}
                        mode={local.themeMode}
                        palette={customPaletteFor(local)}
                        inputs={paletteInputs}
                        invalid={invalidPalette}
                        onSelect={selectTheme}
                        onModeChange={selectThemeMode}
                        onEdit={editPalette}
                        onReset={resetPalette}
                      />
                    </SettingsRow>
                    <SettingsRow last label={t('settings.appearance.font')}>
                      <SettingsRowControl>
                        <ToggleGroup
                          label={t('settings.appearance.fontFamily')}
                          value={local.fontFamily}
                          options={[
                            { value: 'inter', label: t('settings.appearance.font.inter') },
                            { value: 'manrope', label: t('settings.appearance.font.manrope') },
                            { value: 'system', label: t('settings.appearance.font.system') },
                          ]}
                          onChange={(value) =>
                            patch((draft) => {
                              draft.fontFamily = value
                            })
                          }
                        />
                      </SettingsRowControl>
                    </SettingsRow>
                    {appFooter('appearance')}
                  </SettingsSection>
                  <SettingsSection
                    id="commands"
                    title={t('settings.section.commands')}
                    desc={t('settings.section.commands.desc')}
                  >
                    <RetainedSettingsEditor component={CustomCommandsSettings} />
                  </SettingsSection>
                  <SettingsSection
                    id="twir-integration"
                    title={t('settings.section.twir-integration')}
                  >
                    <SettingsRow
                      first
                      last
                      label={t('settings.twir.suggest')}
                      hint={t('settings.twir.suggestHint')}
                    >
                      <Switch
                        checked={local.twirIntegrationEnabled !== false}
                        onChange={(value) =>
                          patch((draft) => {
                            draft.twirIntegrationEnabled = value
                          })
                        }
                      />
                    </SettingsRow>
                    {appFooter('twir-integration')}
                  </SettingsSection>
                  <SettingsSection
                    id="jeetbot-integration"
                    title={t('settings.section.jeetbot-integration')}
                  >
                    <SettingsRow
                      first
                      last
                      label={t('settings.jeetbot.suggest')}
                      hint={t('settings.jeetbot.suggestHint')}
                    >
                      <Switch
                        checked={local.jeetbotIntegrationEnabled !== false}
                        onChange={(value) =>
                          patch((draft) => {
                            draft.jeetbotIntegrationEnabled = value
                          })
                        }
                      />
                    </SettingsRow>
                    {appFooter('jeetbot-integration')}
                  </SettingsSection>
                  <SettingsSection
                    id="fossabot-integration"
                    title={t('settings.section.fossabot-integration')}
                  >
                    <SettingsRow
                      first
                      last
                      label={t('settings.fossabot.suggest')}
                      hint={t('settings.fossabot.suggestHint')}
                    >
                      <Switch
                        checked={local.fossabotIntegrationEnabled !== false}
                        onChange={(value) =>
                          patch((draft) => {
                            draft.fossabotIntegrationEnabled = value
                          })
                        }
                      />
                    </SettingsRow>
                    {appFooter('fossabot-integration')}
                  </SettingsSection>
                  <SettingsSection
                    id="nightbot-integration"
                    title={t('settings.section.nightbot-integration')}
                  >
                    <SettingsRow
                      first
                      last
                      label={t('settings.nightbot.suggest')}
                      hint={t('settings.nightbot.suggestHint')}
                    >
                      <Switch
                        checked={local.nightbotIntegrationEnabled !== false}
                        onChange={(value) =>
                          patch((draft) => {
                            draft.nightbotIntegrationEnabled = value
                          })
                        }
                      />
                    </SettingsRow>
                    {appFooter('nightbot-integration')}
                  </SettingsSection>
                  <SettingsSection
                    id="potat-integration"
                    title={t('settings.section.potat-integration')}
                  >
                    <SettingsRow
                      first
                      last
                      label={t('settings.potat.suggest')}
                      hint={t('settings.potat.suggestHint')}
                    >
                      <Switch
                        checked={local.potatIntegrationEnabled !== false}
                        onChange={(value) =>
                          patch((draft) => {
                            draft.potatIntegrationEnabled = value
                          })
                        }
                      />
                    </SettingsRow>
                    {appFooter('potat-integration')}
                  </SettingsSection>
                  <SettingsSection
                    id="supibot-integration"
                    title={t('settings.section.supibot-integration')}
                  >
                    <SettingsRow
                      first
                      last
                      label={t('settings.supibot.suggest')}
                      hint={t('settings.supibot.suggestHint')}
                    >
                      <Switch
                        checked={local.supibotIntegrationEnabled !== false}
                        onChange={(value) =>
                          patch((draft) => {
                            draft.supibotIntegrationEnabled = value
                          })
                        }
                      />
                    </SettingsRow>
                    {appFooter('supibot-integration')}
                  </SettingsSection>
                  <SettingsSection
                    id="players"
                    title={t('settings.section.players')}
                    desc={t('settings.section.players.desc')}
                  >
                    <RetainedSettingsEditor component={PlayerSettings} />
                  </SettingsSection>
                  <SettingsSection id="plugins" title={t('settings.section.plugins')}>
                    <RetainedSettingsEditor component={PluginSettings} />
                  </SettingsSection>
                  <SettingsSection id="donations" title={t('settings.section.donations')}>
                    <RetainedSettingsEditor component={DonationSettings} />
                  </SettingsSection>
                  <SettingsSection
                    id="streamer-mode"
                    title={t('settings.section.streamer-mode')}
                    desc={t('settings.section.streamer-mode.desc')}
                  >
                    <RetainedSettingsEditor component={StreamerModeSettings} />
                  </SettingsSection>
                  <SettingsSection
                    id="similarity"
                    title={t('settings.section.similarity')}
                    desc={t('settings.section.similarity.desc')}
                  >
                    <RetainedSettingsEditor component={SimilaritySettings} />
                  </SettingsSection>
                  {/* Message timestamps */}
                  <SettingsSection
                    id="timestamps"
                    title={t('settings.section.timestamps')}
                    desc={t('settings.section.timestamps.desc')}
                  >
                    <ChatTimestampFormatSettings
                      showTimestamp={local.showTimestamp}
                      timestampFormat={local.timestampFormat}
                      onShowTimestampChange={(showTimestamp) =>
                        patch((draft) => {
                          draft.showTimestamp = showTimestamp
                        })
                      }
                      onTimestampFormatChange={(timestampFormat) =>
                        patch((draft) => {
                          draft.timestampFormat = timestampFormat
                        })
                      }
                    />
                    {appFooter('timestamps')}
                  </SettingsSection>
                  <SettingsSection
                    id="replies"
                    title={t('settings.section.replies')}
                    desc={t('settings.section.replies.desc')}
                  >
                    <SettingsRow
                      first
                      last
                      label={t('settings.chat.replyOnDoubleClick')}
                      hint={t('settings.chat.replyOnDoubleClickHint')}
                    >
                      <Switch
                        testId="settings-reply-on-double-click"
                        checked={local.replyOnDoubleClick}
                        onChange={(value) =>
                          patch((draft) => {
                            draft.replyOnDoubleClick = value
                          })
                        }
                      />
                    </SettingsRow>
                    {appFooter('replies')}
                  </SettingsSection>
                  <SettingsSection
                    id="pause"
                    title={t('settings.section.pause')}
                    desc={t('settings.section.pause.desc')}
                  >
                    <RetainedSettingsEditor component={ChatPauseSettings} />
                  </SettingsSection>
                  <SettingsSection id="twitch-session" title={t('settings.section.twitch-session')}>
                    <RetainedSettingsEditor component={TwitchSessionSettings} />
                  </SettingsSection>
                  <SettingsSection
                    id="notifications"
                    title={t('settings.section.notifications')}
                    desc={t('settings.section.notifications.desc')}
                  >
                    <RetainedSettingsEditor component={NotificationSettings} />
                  </SettingsSection>
                  <SettingsSection
                    id="rules"
                    title={t('settings.section.rules')}
                    desc={t('settings.section.rules.desc')}
                  >
                    <RetainedSettingsEditor component={ChatRulesSettings} />
                  </SettingsSection>
                  <SettingsSection id="emotes" title={t('settings.section.emotes')}>
                    <RetainedSettingsEditor component={EmoteProviderSettings} />
                  </SettingsSection>
                  <SettingsSection id="history" title={t('settings.section.history')}>
                    <RetainedSettingsEditor component={ChatLoggingSettings} />
                  </SettingsSection>
                  <SettingsSection id="image-uploader" title={t('settings.section.image-uploader')}>
                    <RetainedSettingsEditor component={ImageUploaderSettings} />
                  </SettingsSection>
                  <SettingsSection id="translation" title={t('settings.section.translation')}>
                    <RetainedSettingsEditor component={TranslationSettings} />
                  </SettingsSection>
                  <SettingsSection id="moderation" title={t('settings.section.moderation')}>
                    <SettingsRow
                      first
                      label={t('settings.moderation.showRail')}
                      hint={t('settings.moderation.showRailHint')}
                    >
                      <Switch
                        testId="settings-show-moderation-rail"
                        checked={local.showModerationRail !== false}
                        onChange={(value) =>
                          patch((draft) => {
                            draft.showModerationRail = value
                          })
                        }
                      />
                    </SettingsRow>
                    <RetainedSettingsEditor component={ModerationSettings} />
                  </SettingsSection>
                  {/* Self-Ping Highlight */}
                  <SettingsSection
                    id="self-ping"
                    title={t('settings.section.self-ping')}
                    desc={t('settings.section.self-ping.desc')}
                  >
                    <SettingsRow
                      first
                      label={t('settings.selfPing.enable')}
                      hint={t('settings.selfPing.enableHint')}
                    >
                      <Switch
                        checked={local.selfPing.enabled}
                        onChange={(value) =>
                          patch((draft) => {
                            draft.selfPing.enabled = value
                          })
                        }
                      />
                    </SettingsRow>
                    <SettingsRow label={t('settings.selfPing.color')}>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                        }}
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
                    </SettingsRow>
                    <SettingsRow
                      last
                      alignTop
                      label={t('settings.selfPing.preview')}
                      hint={t('settings.selfPing.previewHint')}
                    >
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
                          backgroundColor: local.selfPing.enabled
                            ? local.selfPing.color
                            : undefined,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: theme.accent.primary,
                            flexShrink: 0,
                          }}
                        >
                          {t('settings.selfPing.previewAuthor')}
                        </Text>
                        <Text style={{ fontSize: 13, color: theme.text }}>
                          {t('settings.selfPing.previewMessage', { name: '@YourName' })}
                        </Text>
                      </div>
                    </SettingsRow>
                    {appFooter('self-ping')}
                  </SettingsSection>
                  {/* Updates */}
                  <SettingsSection
                    id="updates"
                    title={t('settings.section.updates')}
                    desc={t('settings.section.updates.desc')}
                  >
                    <SettingsRow
                      first
                      label={t('settings.updates.version')}
                      hint={t('settings.updates.versionHint')}
                    >
                      <Text style={{ fontSize: 13, color: theme.text2 }}>{appVersion}</Text>
                    </SettingsRow>
                    <SettingsRow
                      label={t('settings.updates.checkNow')}
                      hint={t('settings.updates.checkNowHint')}
                    >
                      <div
                        onClick={() => {
                          if (checkingUpdates) return
                          setActionError('')
                          setCheckingUpdates(true)
                          backend.api
                            .checkForUpdate()
                            .catch((error) =>
                              setActionError(
                                t('settings.error.checkUpdates', { error: String(error) }),
                              ),
                            )
                            .finally(() => setCheckingUpdates(false))
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
                          opacity: checkingUpdates ? 0.6 : 1,
                          cursor: checkingUpdates ? 'default' : 'pointer',
                        }}
                      >
                        <Text style={{ fontSize: 13, color: theme.text }}>
                          {checkingUpdates
                            ? t('settings.updates.checking')
                            : t('settings.updates.check')}
                        </Text>
                      </div>
                    </SettingsRow>
                    <SettingsRow
                      last
                      label={t('settings.updates.auto')}
                      hint={t('settings.updates.autoHint')}
                    >
                      <Switch
                        checked={local.autoCheckUpdates ?? false}
                        onChange={(value) =>
                          patch((draft) => {
                            draft.autoCheckUpdates = value
                          })
                        }
                      />
                    </SettingsRow>
                    {appFooter('updates')}
                  </SettingsSection>
                  {/* OBS Overlay */}
                  <SettingsSection
                    id="overlay"
                    title={t('settings.section.overlay')}
                    desc={t('settings.section.overlay.desc')}
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
                          color: theme.accent.primary,
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
                          backgroundColor: theme.accent.tint12,
                          borderWidth: 1,
                          borderColor: theme.accent.tint25,
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
                        <Icon name="copy" size={14} color={theme.accent.primary} />
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: theme.accent.primary,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {t('common.copy')}
                        </Text>
                      </div>
                    </div>

                    <SettingsRow label={t('settings.overlay.port')}>
                      <SmallInput
                        value={String(local.overlay.port)}
                        onChange={(value) => {
                          if (!/^\d+$/.test(value)) return
                          patch((draft) => {
                            draft.overlay.port = parseInt(value, 10)
                          })
                        }}
                      />
                    </SettingsRow>

                    <SettingsRow
                      label={t('settings.overlay.background')}
                      hint={t('settings.overlay.backgroundHint')}
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                        }}
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
                    </SettingsRow>

                    <SettingsRow label={t('settings.overlay.textColor')}>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                        }}
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
                    </SettingsRow>

                    <SettingsRow label={t('settings.overlay.fontSize')}>
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
                          style={{
                            fontSize: 12,
                            color: theme.text2,
                            width: 36,
                            textAlign: 'right',
                          }}
                        >
                          {`${local.overlay.fontSize}px`}
                        </Text>
                      </div>
                    </SettingsRow>

                    <SettingsRow label={t('settings.overlay.maxMessages')}>
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
                          style={{
                            fontSize: 12,
                            color: theme.text2,
                            width: 36,
                            textAlign: 'right',
                          }}
                        >
                          {local.overlay.maxMessages}
                        </Text>
                      </div>
                    </SettingsRow>

                    <SettingsRow label={t('settings.overlay.animation')}>
                      <SettingsRowControl>
                        <ToggleGroup
                          label={t('settings.overlay.animationLabel')}
                          value={local.overlay.animation}
                          options={[
                            { value: 'slide', label: t('settings.overlay.animation.slide') },
                            { value: 'fade', label: t('settings.overlay.animation.fade') },
                            { value: 'none', label: t('settings.overlay.animation.none') },
                          ]}
                          onChange={(value) =>
                            patch((draft) => {
                              draft.overlay.animation = value
                            })
                          }
                        />
                      </SettingsRowControl>
                    </SettingsRow>

                    <SettingsRow label={t('settings.overlay.position')}>
                      <SettingsRowControl>
                        <ToggleGroup
                          label={t('settings.overlay.positionLabel')}
                          value={local.overlay.position}
                          options={[
                            { value: 'bottom', label: t('settings.overlay.position.bottom') },
                            { value: 'top', label: t('settings.overlay.position.top') },
                          ]}
                          onChange={(value) =>
                            patch((draft) => {
                              draft.overlay.position = value
                            })
                          }
                        />
                      </SettingsRowControl>
                    </SettingsRow>

                    <SettingsRow label={t('settings.overlay.showPlatformIcon')}>
                      <Switch
                        checked={local.overlay.showPlatformIcon}
                        onChange={(value) =>
                          patch((draft) => {
                            draft.overlay.showPlatformIcon = value
                          })
                        }
                      />
                    </SettingsRow>

                    <SettingsRow last label={t('settings.overlay.showAvatars')}>
                      <Switch
                        checked={local.overlay.showAvatar}
                        onChange={(value) =>
                          patch((draft) => {
                            draft.overlay.showAvatar = value
                          })
                        }
                      />
                    </SettingsRow>
                    {appFooter('overlay')}
                  </SettingsSection>
                  {/* Keyboard Shortcuts */}
                  <SettingsSection id="shortcuts" title={t('settings.section.shortcuts')}>
                    <ActionHotkeySettings />
                    <Text
                      style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginTop: 8 }}
                    >
                      {t('settings.shortcuts.navigation')}
                    </Text>
                    <Text style={{ fontSize: 11, color: theme.text2 }}>
                      {t('settings.shortcuts.navigationHint')}
                    </Text>
                    {HOTKEYS_CONFIG.map((config, index) => {
                      const recording = recordingAction === config.action
                      return (
                        <SettingsRow
                          key={config.action}
                          first={index === 0}
                          last={index === HOTKEYS_CONFIG.length - 1}
                          label={t(config.labelKey)}
                          hint={t(config.descriptionKey)}
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
                              backgroundColor: recording ? theme.accent.tint10 : theme.surface2,
                              borderWidth: 1,
                              borderColor: recording ? theme.accent.primary : theme.border,
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
                                style={{
                                  fontSize: 12,
                                  color: theme.accent.primary,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {t('settings.shortcuts.pressKey')}
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
                        </SettingsRow>
                      )
                    })}
                    {appFooter('shortcuts')}
                  </SettingsSection>
                </SettingsDirtyReporterContext.Provider>
              </SettingsSaveRegistryContext.Provider>
            </SettingsSectionContext.Provider>
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
      <SettingsLeaveDialog />
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
      theme={{ caret: theme.accent.primary }}
      style={{
        width,
        maxWidth: '100%',
        minWidth: 0,
        flexShrink: 1,
        backgroundColor: theme.surface2,
        borderWidth: 1,
        borderColor: focused ? theme.accent.primary : theme.border,
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
