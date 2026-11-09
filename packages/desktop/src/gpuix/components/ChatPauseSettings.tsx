import { useEffect, useRef, useState } from 'react'

import {
  PAUSE_MODIFIER_KEYS,
  validateChatPausePreferences,
  type ChatPausePreferences,
  type PauseModifierKey,
} from '../../services/chat-pause'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { t as translate, useT } from '../i18n'
import { chatPausePreferences, chatPauseStore } from '../state/chat-pause'
import { useStore } from '../state/create-store'
import { useTheme } from '../theme-context'
import { SettingsFooter } from './settings/SettingsLayout'
import { ActionButton, FormField, FormInput } from './ui/Form'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'

type HoverMode = 'off' | 'inside' | 'timed'
interface Draft {
  mode: HoverMode
  seconds: string
  modifier: string
  doubleClickLinks: boolean
}
const labels: Record<PauseModifierKey, string> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  cmd: 'Cmd / Super',
}
function draftFromSettings(value: ChatPausePreferences): Draft {
  return {
    mode: value.hoverSeconds === 0 ? 'off' : value.hoverSeconds === -1 ? 'inside' : 'timed',
    seconds: value.hoverSeconds > 0 ? String(value.hoverSeconds) : '2',
    modifier: value.modifier,
    doubleClickLinks: value.doubleClickLinks,
  }
}
function settingsFromDraft(draft: Draft): ChatPausePreferences {
  if (draft.mode === 'timed' && !draft.seconds.trim())
    throw new Error(translate('chatPauseSettings.enterDuration'))
  const hoverSeconds =
    draft.mode === 'off' ? 0 : draft.mode === 'inside' ? -1 : Number(draft.seconds)
  if (draft.mode === 'timed' && !(hoverSeconds > 0))
    throw new Error(translate('chatPauseSettings.timedRange'))
  return validateChatPausePreferences({
    hoverSeconds,
    modifier: draft.modifier,
    doubleClickLinks: draft.doubleClickLinks,
  })
}

export function ChatPauseSettings() {
  const backend = useBackend()
  const theme = useTheme()
  const { t } = useT()
  const state = useStore(chatPauseStore)
  const [draft, setDraft] = useState(() => draftFromSettings(state.value))
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState('')
  const revision = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    runUiTask(chatPausePreferences.load(backend.api))
    return () => {
      mounted.current = false
    }
  }, [backend])
  useEffect(() => {
    if (dirty) return
    try {
      if (JSON.stringify(settingsFromDraft(draft)) === JSON.stringify(state.value)) return
    } catch {
      // An invalid local edit is retained until the user repairs or replaces it.
      return
    }
    setDraft(draftFromSettings(state.value))
  }, [state.value, dirty, draft])
  const validation = (() => {
    try {
      settingsFromDraft(draft)
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  })()
  async function save(): Promise<boolean> {
    let value: ChatPausePreferences
    try {
      value = settingsFromDraft(draft)
    } catch {
      return false
    }
    const requested = revision.current
    setNotice('')
    try {
      await chatPausePreferences.save(backend.api, value)
      const current = mounted.current && revision.current === requested
      if (current) setDirty(false)
      return current
    } catch {
      // The preference store retains the failed value and exposes the save error for retry.
      return false
    }
  }
  function change(next: Draft): void {
    revision.current++
    setDraft(next)
    setDirty(true)
    setNotice('')
  }
  function discard(): void {
    revision.current++
    setDraft(draftFromSettings(state.value))
    setDirty(false)
    setNotice('')
  }
  function changeModifier(key: PauseModifierKey, enabled: boolean): void {
    const keys = new Set(draft.modifier === 'none' ? [] : draft.modifier.split('+'))
    if (enabled) keys.add(key)
    else keys.delete(key)
    change({
      ...draft,
      modifier: PAUSE_MODIFIER_KEYS.filter((modifier) => keys.has(modifier)).join('+') || 'none',
    })
  }
  return (
    <div testId="chat-pause-settings" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Text style={{ fontSize: 12, color: theme.text2 }}>{t('chatPauseSettings.intro')}</Text>
      {!state.loaded && !state.error ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>{t('chatPauseSettings.loading')}</Text>
      ) : null}
      {state.loaded ? (
        <>
          <FormField
            label={t('chatPauseSettings.pauseOnMove')}
            hint={t('chatPauseSettings.pauseOnMoveHint')}
          >
            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {(
                [
                  ['off', t('chatPauseSettings.mode.off')],
                  ['inside', t('chatPauseSettings.mode.inside')],
                  ['timed', t('chatPauseSettings.mode.timed')],
                ] satisfies [HoverMode, string][]
              ).map(([mode, label]) => (
                <ActionButton
                  key={mode}
                  testId={`pause-hover-${mode}`}
                  primary={draft.mode === mode}
                  onClick={() => change({ ...draft, mode })}
                >
                  {label}
                </ActionButton>
              ))}
            </div>
          </FormField>
          {draft.mode === 'timed' ? (
            <FormField
              label={t('chatPauseSettings.secondsAfter')}
              hint={t('chatPauseSettings.secondsAfterHint')}
            >
              <FormInput
                testId="pause-hover-seconds"
                value={draft.seconds}
                onChange={(seconds) => change({ ...draft, seconds })}
              />
            </FormField>
          ) : null}
          <FormField
            label={t('chatPauseSettings.pauseKeys')}
            hint={t('chatPauseSettings.pauseKeysHint')}
          >
            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {PAUSE_MODIFIER_KEYS.map((key) => (
                <div
                  key={key}
                  testId={`pause-modifier-${key}`}
                  tabIndex={0}
                  role="switch"
                  aria-label={t('chatPauseSettings.modifierAria', { key: labels[key] })}
                  aria-checked={draft.modifier.split('+').includes(key)}
                  onKeyDown={(event) => {
                    if (event.key === 'enter' || event.key === 'space') {
                      event.preventDefault()
                      changeModifier(key, !draft.modifier.split('+').includes(key))
                    }
                  }}
                  style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}
                >
                  <Text style={{ fontSize: 12, color: theme.text }}>{labels[key]}</Text>
                  <Switch
                    checked={draft.modifier.split('+').includes(key)}
                    onChange={(enabled) => changeModifier(key, enabled)}
                  />
                </div>
              ))}
            </div>
            <Text style={{ fontSize: 11, color: theme.text2 }}>
              {draft.modifier === 'none'
                ? t('chatPauseSettings.keyboardPauseDisabled')
                : t('chatPauseSettings.exactCombination', { combination: draft.modifier })}
            </Text>
          </FormField>
          <FormField
            label={t('chatPauseSettings.linkClicks')}
            hint={t('chatPauseSettings.linkClicksHint')}
          >
            <div
              testId="pause-double-click"
              tabIndex={0}
              role="switch"
              aria-label={t('chatPauseSettings.requireDoubleClick')}
              aria-checked={draft.doubleClickLinks}
              onKeyDown={(event) => {
                if (event.key === 'enter' || event.key === 'space') {
                  event.preventDefault()
                  change({ ...draft, doubleClickLinks: !draft.doubleClickLinks })
                }
              }}
              style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <Text style={{ fontSize: 12, color: theme.text, flexGrow: 1 }}>
                {t('chatPauseSettings.requireDoubleClick')}
              </Text>
              <Switch
                checked={draft.doubleClickLinks}
                onChange={(doubleClickLinks) => change({ ...draft, doubleClickLinks })}
              />
            </div>
          </FormField>
        </>
      ) : null}
      <SettingsFooter
        sectionId="pause"
        dirty={dirty}
        saving={state.saving}
        error={validation || state.error || undefined}
        note={notice}
        disabled={!state.loaded || Boolean(validation)}
        saveTestId="save-chat-pause"
        errorTestId="chat-pause-error"
        onSave={save}
        onDiscard={discard}
      >
        {state.error && !dirty ? (
          <ActionButton onClick={() => void chatPausePreferences.load(backend.api)}>
            {t('chatPauseSettings.reload')}
          </ActionButton>
        ) : null}
      </SettingsFooter>
    </div>
  )
}
