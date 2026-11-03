import { useEffect, useMemo, useRef, useState } from 'react'

import {
  PAUSE_MODIFIER_KEYS,
  validateChatPausePreferences,
  type ChatPausePreferences,
  type PauseModifierKey,
} from '../../services/chat-pause'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { chatPausePreferences, chatPauseStore } from '../state/chat-pause'
import { useStore } from '../state/create-store'
import { useTheme } from '../theme-context'
import { ActionButton, FormError, FormField, FormInput } from './ui/Form'
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
    throw new Error('Enter a hover pause duration.')
  const hoverSeconds =
    draft.mode === 'off' ? 0 : draft.mode === 'inside' ? -1 : Number(draft.seconds)
  if (draft.mode === 'timed' && !(hoverSeconds > 0))
    throw new Error('Timed hover pause must be greater than 0 and at most 300 seconds.')
  return validateChatPausePreferences({
    hoverSeconds,
    modifier: draft.modifier,
    doubleClickLinks: draft.doubleClickLinks,
  })
}

export function ChatPauseSettings() {
  const backend = useBackend()
  const theme = useTheme()
  const state = useStore(chatPauseStore)
  const [draft, setDraft] = useState(() => draftFromSettings(state.value))
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
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
  const validation = useMemo(() => {
    try {
      settingsFromDraft(draft)
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, [draft])
  async function save(next = draft, requested = revision.current): Promise<void> {
    let value: ChatPausePreferences
    try {
      value = settingsFromDraft(next)
    } catch {
      return
    }
    try {
      await chatPausePreferences.save(backend.api, value)
      if (mounted.current && revision.current === requested) {
        setDirty(false)
        setSaved(true)
      }
    } catch {
      // The preference store retains the failed value and exposes the save error for retry.
    }
  }
  function change(next: Draft): void {
    const requested = ++revision.current
    setDraft(next)
    setDirty(true)
    setSaved(false)
    runUiTask(save(next, requested))
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
      <Text style={{ fontSize: 12, color: theme.text2 }}>
        Pause chat to keep messages still while reading. Each pause reason expires independently;
        hover and keyboard shortcuts never cancel a manual pause or a search.
      </Text>
      {!state.loaded && !state.error ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>Loading pause settings…</Text>
      ) : null}
      {state.loaded ? (
        <>
          <FormField
            label="Pause on mouse movement"
            hint="Disabled by default. Timed pauses refresh after every mouse movement; leaving the chat releases only its mouse pause."
          >
            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {(
                [
                  ['off', 'Disabled'],
                  ['inside', 'While hovering'],
                  ['timed', 'For a duration'],
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
              label="Seconds after the last movement"
              hint="A duration greater than 0 and at most 300 seconds. Decimals are supported."
            >
              <FormInput
                testId="pause-hover-seconds"
                value={draft.seconds}
                onChange={(seconds) => change({ ...draft, seconds })}
              />
            </FormField>
          ) : null}
          <FormField
            label="Pause while these keys are held"
            hint="The combination must match exactly. Holding an additional modifier resumes the chat. Leave every key off to disable."
          >
            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {PAUSE_MODIFIER_KEYS.map((key) => (
                <div
                  key={key}
                  testId={`pause-modifier-${key}`}
                  tabIndex={0}
                  role="switch"
                  aria-label={`${labels[key]} pause modifier`}
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
                ? 'Keyboard pause disabled'
                : `Exact combination: ${draft.modifier}`}
            </Text>
          </FormField>
          <FormField
            label="Link clicks"
            hint="The first left click briefly pauses chat for 200 ms, so the link stays under your pointer. Window deactivation releases this brief pause and the keyboard pause."
          >
            <div
              testId="pause-double-click"
              tabIndex={0}
              role="switch"
              aria-label="Require double-click to open links"
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
                Require double-click to open links
              </Text>
              <Switch
                checked={draft.doubleClickLinks}
                onChange={(doubleClickLinks) => change({ ...draft, doubleClickLinks })}
              />
            </div>
          </FormField>
        </>
      ) : null}
      <FormError>{validation || state.error}</FormError>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Text style={{ fontSize: 11, color: theme.text2 }}>
          {state.saving
            ? 'Saving pause settings…'
            : saved && !dirty && !state.error
              ? 'Pause settings saved.'
              : 'Valid changes save automatically.'}
        </Text>
        {state.error && !dirty ? (
          <ActionButton onClick={() => void chatPausePreferences.load(backend.api)}>
            Reload settings
          </ActionButton>
        ) : null}
        {state.loaded ? (
          <ActionButton
            testId="save-chat-pause"
            primary
            disabled={!!validation || state.saving}
            onClick={() => void save()}
          >
            {state.error ? 'Retry save' : 'Save pause settings'}
          </ActionButton>
        ) : null}
      </div>
    </div>
  )
}
