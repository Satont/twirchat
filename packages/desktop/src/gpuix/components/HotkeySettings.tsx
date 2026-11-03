import type { KeyEvent } from '@gpuix/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import {
  HOTKEY_ACTIONS,
  isHotkeyCategory,
  recordHotkeyStroke,
  parseHotkeyArguments,
  validateHotkeyBindings,
  type HotkeyBinding,
  type HotkeyCategory,
} from '../hotkey-bindings'
import {
  actionBindingsPreferences,
  actionBindingsStore,
  loadActionBindings,
  registerHotkeyRecorder,
} from '../state/action-bindings'
import { useStore } from '../state/create-store'
import { useWindowScope } from '../state/window-scope'
import { useTheme } from '../theme-context'
import { ActionButton, FormError, FormField, FormInput } from './ui/Form'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'

const categories = Object.keys(HOTKEY_ACTIONS).filter(isHotkeyCategory)
const categoryNames: Record<HotkeyCategory, string> = {
  window: 'Window',
  split: 'Split',
  splitInput: 'Message input',
  popupWindow: 'Popup',
}
const actionName = (action: string): string => {
  const words = action.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
export function HotkeySettings() {
  const backend = useBackend()
  const scope = useWindowScope()
  const theme = useTheme()
  const state = useStore(actionBindingsStore)
  const [draft, setDraft] = useState(() => structuredClone(state.value))
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const capture = useRef<(event: KeyEvent) => void>(() => {})
  const revision = useRef(0)
  const recordingOriginalKeys = useRef<string[]>([])
  useEffect(() => {
    runUiTask(loadActionBindings(backend.api))
  }, [backend])
  useEffect(() => {
    if (!dirty) setDraft(structuredClone(state.value))
  }, [dirty, state.value])
  useEffect(() => {
    if (recording) return registerHotkeyRecorder(scope, (event) => capture.current(event))
  }, [recording, scope])
  const change = (update: (value: typeof draft) => void) => {
    revision.current++
    setDirty(true)
    setError('')
    setNotice('')
    setDraft((current) => {
      const next = structuredClone(current)
      update(next)
      return next
    })
  }
  const binding = draft.bindings.find((entry) => entry.id === selected)
  const edit = (update: (entry: HotkeyBinding) => void) =>
    change((value) => {
      const entry = value.bindings.find((item) => item.id === selected)
      if (entry) update(entry)
    })
  const validation = useMemo(() => {
    try {
      validateHotkeyBindings(draft.bindings)
      return ''
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }
  }, [draft.bindings])
  capture.current = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const result = recordHotkeyStroke(binding?.keys ?? [], event)
    if (!result) return
    if (result.cancelled) {
      edit((entry) => {
        entry.keys = recordingOriginalKeys.current
      })
      setRecording(false)
      return
    }
    edit((entry) => {
      entry.keys = result.keys
    })
    if (result.complete) setRecording(false)
  }
  const save = async () => {
    const requested = revision.current
    try {
      await actionBindingsPreferences.save(backend.api, draft)
      if (revision.current === requested) {
        setDirty(false)
        setNotice('Shortcuts saved.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 12 }}>
      <Text style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>Action shortcuts</Text>
      <Text style={{ fontSize: 12, color: theme.text2 }}>
        Choose an action and its context. A shortcut runs only when that context provides the
        action; unavailable actions leave the key untouched.
      </Text>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Switch
          checked={draft.legacyNavigation}
          onChange={(value) =>
            change((next) => {
              next.legacyNavigation = value
            })
          }
        />
        <Text style={{ fontSize: 12, color: theme.text }}>
          Keep the four navigation shortcuts in this section
        </Text>
      </div>
      {!state.loaded ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>Loading shortcuts…</Text>
      ) : null}
      <FormError>{error || state.error || validation}</FormError>
      {state.error && !dirty ? (
        <ActionButton
          onClick={() => {
            runUiTask(loadActionBindings(backend.api))
          }}
        >
          Retry loading
        </ActionButton>
      ) : null}
      {draft.bindings.length === 0 ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>
          No action shortcuts yet. Add one to bind a key or a sequence of up to four keys.
        </Text>
      ) : null}
      {draft.bindings.map((entry) => (
        <div key={entry.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <ActionButton
            onClick={() => {
              setSelected(entry.id)
              setRecording(false)
            }}
          >
            {entry.name || `${categoryNames[entry.category]} · ${actionName(entry.action)}`}
          </ActionButton>
          <Text style={{ fontSize: 11, color: theme.text2 }}>
            {entry.keys.join(' → ') || 'No keys'}
            {entry.enabled ? '' : ' · Disabled'}
          </Text>
          <ActionButton
            danger
            onClick={() => {
              change((value) => {
                value.bindings = value.bindings.filter((item) => item.id !== entry.id)
              })
              if (selected === entry.id) {
                setSelected(null)
                setRecording(false)
              }
            }}
          >
            Remove
          </ActionButton>
        </div>
      ))}
      <ActionButton
        testId="hotkey-add"
        disabled={!state.loaded || state.saving || draft.bindings.length >= 512}
        onClick={() => {
          const id = crypto.randomUUID()
          change((value) => {
            value.bindings.push({
              id,
              name: '',
              enabled: true,
              category: 'window',
              action: 'openSettings',
              keys: [],
              arguments: [],
            })
          })
          setSelected(id)
        }}
      >
        Add action shortcut
      </ActionButton>
      {binding ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: 12,
            backgroundColor: theme.surface2,
            borderRadius: 6,
          }}
        >
          <FormField label="Name">
            <FormInput
              value={binding.name}
              onChange={(value) =>
                edit((entry) => {
                  entry.name = value
                })
              }
              placeholder="Optional shortcut name"
            />
          </FormField>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Switch
              checked={binding.enabled}
              onChange={(value) =>
                edit((entry) => {
                  entry.enabled = value
                })
              }
            />
            <Text style={{ fontSize: 12, color: theme.text }}>Enabled</Text>
          </div>
          <FormField label="Context">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {categories.map((category) => (
                <ActionButton
                  key={categoryNames[category]}
                  primary={binding.category === category}
                  onClick={() =>
                    edit((entry) => {
                      entry.category = category
                      entry.action = HOTKEY_ACTIONS[category][0]
                      entry.arguments = []
                    })
                  }
                >
                  {categoryNames[category]}
                </ActionButton>
              ))}
            </div>
          </FormField>
          <FormField label="Action">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {HOTKEY_ACTIONS[binding.category].map((action) => (
                <ActionButton
                  key={actionName(action)}
                  primary={binding.action === action}
                  onClick={() =>
                    edit((entry) => {
                      entry.action = action
                      entry.arguments = []
                    })
                  }
                >
                  {actionName(action)}
                </ActionButton>
              ))}
            </div>
          </FormField>
          <FormField
            label="Arguments"
            hint="One argument per line. Spaces inside commands are preserved. Blank argument lines are invalid."
          >
            <FormInput
              multiline
              value={binding.arguments.join('\n')}
              onChange={(value) =>
                edit((entry) => {
                  entry.arguments = parseHotkeyArguments(value)
                })
              }
            />
          </FormField>
          <FormField
            label="Key sequence"
            hint="One chord per line, for example Ctrl+K then Ctrl+C. Use Cmd for the system modifier."
          >
            <FormInput
              multiline
              value={binding.keys.join('\n')}
              onChange={(value) =>
                edit((entry) => {
                  entry.keys = value.split('\n')
                })
              }
            />
          </FormField>
          <div style={{ display: 'flex', gap: 6 }}>
            <ActionButton
              testId="hotkey-record"
              onClick={() => {
                recordingOriginalKeys.current = [...binding.keys]
                edit((entry) => {
                  entry.keys = []
                })
                setRecording(true)
              }}
            >
              Record keys
            </ActionButton>
            {recording ? (
              <ActionButton onClick={() => setRecording(false)}>Finish recording</ActionButton>
            ) : null}
          </div>
          {recording ? (
            <div
              testId="action-hotkey-capture"
              autoFocus
              tabIndex={0}
              onKeyDown={(event) => capture.current(event)}
              style={{ padding: 10, borderWidth: 1, borderColor: theme.border, borderRadius: 5 }}
            >
              <Text style={{ fontSize: 12, color: theme.text }}>
                Press up to four keys. Enter is recorded; Escape cancels recording.
              </Text>
            </div>
          ) : null}
        </div>
      ) : null}
      {notice ? <Text style={{ fontSize: 12, color: theme.text2 }}>{notice}</Text> : null}
      <ActionButton
        testId="hotkey-save"
        primary
        disabled={!dirty || Boolean(validation) || !state.loaded || state.saving || recording}
        onClick={() => {
          runUiTask(save())
        }}
      >
        {state.saving
          ? 'Saving…'
          : state.error && dirty
            ? 'Retry save shortcuts'
            : 'Save action shortcuts'}
      </ActionButton>
    </div>
  )
}
