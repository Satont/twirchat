import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react'

import { useT } from '../../i18n'
import type { SettingsSectionId } from '../../settings-search'
import { useTheme } from '../../theme-context'
import { ActionButton } from '../ui/Form'
import { Text } from '../ui/Text'

export interface SettingsSectionVisibility {
  visible: ReadonlySet<SettingsSectionId>
  mounted: ReadonlySet<SettingsSectionId>
  dirty: ReadonlySet<SettingsSectionId>
  narrow: boolean
}

export const SettingsSectionContext = createContext<SettingsSectionVisibility>({
  visible: new Set(),
  mounted: new Set(),
  dirty: new Set(),
  narrow: false,
})

type SettingsDirtyReporter = (id: SettingsSectionId, dirty: boolean) => void

export const SettingsDirtyReporterContext = createContext<SettingsDirtyReporter>(() => {})

export interface SettingsSectionController {
  dirty: boolean
  saving: boolean
  save: () => Promise<boolean>
  discard: () => void
}

export interface SettingsSaveRegistry {
  register: (key: string, controller: SettingsSectionController) => void
  unregister: (key: string) => void
}

/**
 * Present inside SettingsPanel: sections register their draft so one global
 * Save/Discard can act on all of them. Outside the panel (standalone editors)
 * the footer falls back to local Save/Discard buttons.
 */
export const SettingsSaveRegistryContext = createContext<SettingsSaveRegistry | null>(null)

/** Reports a staged draft so the section header and category navigation can mark it. */
export function useSettingsDirtyReporting(id: SettingsSectionId, dirty: boolean): void {
  const report = useContext(SettingsDirtyReporterContext)
  useEffect(() => {
    report(id, dirty)
    return () => report(id, false)
  }, [dirty, id, report])
}

/** Section card with a consistent title, description and unsaved marker. */
export function SettingsSection({
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
  const { t } = useT()
  const visibility = useContext(SettingsSectionContext)
  if (!visibility.mounted.has(id)) return null
  const visible = visibility.visible.has(id)
  const dirty = visibility.dirty.has(id)
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
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: desc ? 4 : 14,
        }}
      >
        <Text style={{ fontSize: 12, fontWeight: 700, color: theme.text2 }}>
          {title.toUpperCase()}
        </Text>
        {dirty ? (
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: theme.accent.primary,
              }}
            />
            <Text style={{ fontSize: 10, fontWeight: 700, color: theme.accent.primary }}>
              {t('common.unsaved')}
            </Text>
          </div>
        ) : null}
      </div>
      {desc ? (
        <Text style={{ fontSize: 12, color: theme.text2, marginBottom: 14 }}>{desc}</Text>
      ) : null}
      {children}
    </div>
  )
}

/** Label + control row used by every section. */
export function SettingsRow({
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
  const { narrow } = useContext(SettingsSectionContext)
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

/**
 * Shared visual contract for every section: state on the left, extra actions
 * on the right. Inside SettingsPanel the footer only registers the draft with
 * the panel-wide Save/Discard; standalone editors keep local Save/Discard.
 */
export function SettingsFooter({
  sectionId,
  dirty = false,
  saving = false,
  error = '',
  note,
  saveLabel,
  saveTestId,
  errorTestId,
  disabled = false,
  onSave,
  onDiscard,
  children,
}: {
  sectionId: SettingsSectionId
  dirty?: boolean
  saving?: boolean
  error?: string
  note?: string
  saveLabel?: string
  saveTestId?: string
  errorTestId?: string
  disabled?: boolean
  onSave?: () => Promise<boolean> | boolean
  onDiscard?: () => void
  children?: ReactNode
}) {
  const theme = useTheme()
  const { t } = useT()
  const registry = useContext(SettingsSaveRegistryContext)
  const controllerKey = useId()
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const discardRef = useRef(onDiscard)
  discardRef.current = onDiscard
  const stateRef = useRef({ dirty, saving })
  stateRef.current = { dirty, saving }
  useSettingsDirtyReporting(sectionId, dirty)
  useEffect(() => {
    if (!registry || !saveRef.current) return
    registry.register(controllerKey, {
      get dirty() {
        return stateRef.current.dirty
      },
      get saving() {
        return stateRef.current.saving
      },
      save: async () => (await saveRef.current?.()) ?? false,
      discard: () => discardRef.current?.(),
    })
    return () => registry.unregister(controllerKey)
  }, [controllerKey, registry])
  const hasStatus = Boolean(error) || saving || dirty || Boolean(note)
  // Inside SettingsPanel a clean section has nothing to report: the panel header
  // already owns the global save state, so keep the section card free of a
  // redundant "All changes saved" strip.
  if (!hasStatus && !children && registry !== null) return null
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 4,
        paddingTop: 14,
        borderTopWidth: 1,
        borderColor: theme.border,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 120 }}>
        {error ? (
          <Text testId={errorTestId} style={{ fontSize: 11, color: theme.dangerText }}>
            {error}
          </Text>
        ) : saving ? (
          <Text style={{ fontSize: 11, color: theme.text2 }}>{t('settings.footer.saving')}</Text>
        ) : dirty ? (
          <>
            <Text style={{ fontSize: 11, color: theme.text }}>{t('settings.footer.unsaved')}</Text>
            {note ? <Text style={{ fontSize: 11, color: theme.text2 }}>{note}</Text> : null}
          </>
        ) : note ? (
          <Text style={{ fontSize: 11, color: theme.text2 }}>{note}</Text>
        ) : null}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        {children}
        {registry === null
          ? [
              dirty && onDiscard ? (
                <ActionButton key="discard" disabled={saving} onClick={onDiscard}>
                  {t('common.discard')}
                </ActionButton>
              ) : null,
              onSave ? (
                <ActionButton
                  key="save"
                  primary
                  testId={saveTestId}
                  disabled={saving || disabled || !dirty}
                  onClick={() => void onSave()}
                >
                  {saving
                    ? t('common.saving')
                    : error
                      ? t('common.retrySave')
                      : (saveLabel ?? t('common.saveChanges'))}
                </ActionButton>
              ) : null,
            ]
          : null}
      </div>
    </div>
  )
}
