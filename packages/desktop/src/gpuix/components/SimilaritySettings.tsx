import { useEffect, useMemo, useRef, useState } from 'react'

import {
  validateMessageSimilaritySettings,
  type MessageSimilaritySettings,
} from '../../services/message-similarity'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useStore } from '../state/create-store'
import {
  loadMessageSimilaritySettings,
  messageSimilarityPreferences,
  messageSimilarityStore,
} from '../state/message-similarity'
import { useTheme } from '../theme-context'
import { ActionButton, FormError, FormField, FormInput } from './ui/Form'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'
const toggles: [keyof MessageSimilaritySettings, string][] = [
  ['enabled', 'Check incoming messages for similarity'],
  ['hideSimilar', 'Hide messages marked similar'],
  ['sameUserOnly', 'Compare messages from the same user only'],
  ['excludeOwn', 'Exclude my own messages'],
  ['graySimilar', 'Gray out similar messages'],
  ['shownSimilarTriggerHighlights', 'Allow shown similar messages to trigger highlights'],
]
export function SimilaritySettings() {
  const backend = useBackend()
  const theme = useTheme()
  const state = useStore(messageSimilarityStore)
  const [draft, setDraft] = useState(() => structuredClone(state.value))
  const [numeric, setNumeric] = useState(() => ({
    threshold: String(state.value.threshold),
    maxMessages: String(state.value.maxMessages),
    delaySeconds: String(state.value.delaySeconds),
  }))
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const revision = useRef(0)
  useEffect(() => {
    runUiTask(loadMessageSimilaritySettings(backend))
  }, [backend])
  useEffect(() => {
    if (!dirty) {
      setDraft(structuredClone(state.value))
      setNumeric({
        threshold: String(state.value.threshold),
        maxMessages: String(state.value.maxMessages),
        delaySeconds: String(state.value.delaySeconds),
      })
    }
  }, [dirty, state.value])
  const edit = (key: keyof MessageSimilaritySettings, value: number | boolean) => {
    revision.current++
    setDirty(true)
    setError('')
    setNotice('')
    setDraft((current) => ({ ...current, [key]: value }))
  }
  const editNumber = (key: 'threshold' | 'maxMessages' | 'delaySeconds', value: string) => {
    setNumeric((current) => ({ ...current, [key]: value }))
    edit(key, value.trim() ? Number(value) : NaN)
  }
  const validation = useMemo(() => {
    try {
      validateMessageSimilaritySettings(draft)
      return ''
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }
  }, [draft])
  const save = async () => {
    const requested = revision.current
    try {
      await messageSimilarityPreferences.save(backend.api, draft)
      if (requested === revision.current) {
        setDirty(false)
        setNotice('Similarity settings saved.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Text style={{ color: theme.text2, fontSize: 12 }}>
        Compare incoming Twitch and Kick messages using their longest shared contiguous text. Checks
        are case-sensitive. Existing message flags stay fixed when settings change; hiding, gray and
        highlight options update their presentation.
      </Text>
      <FormError>{error || state.error || validation}</FormError>
      {state.error && !dirty ? (
        <ActionButton
          onClick={() => {
            runUiTask(loadMessageSimilaritySettings(backend))
          }}
        >
          Retry loading similarity settings
        </ActionButton>
      ) : null}
      {toggles.map(([key, label]) => (
        <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Switch checked={Boolean(draft[key])} onChange={(value) => edit(key, value)} />
          <Text style={{ color: theme.text, fontSize: 12 }}>{label}</Text>
        </div>
      ))}
      <FormField
        label="Similarity threshold"
        hint="0–1. A message must score strictly above this value; 1 never matches."
      >
        <FormInput value={numeric.threshold} onChange={(value) => editNumber('threshold', value)} />
      </FormField>
      <FormField
        label="Preceding messages"
        hint="Compare the last 0–100 messages before applying the same-user condition."
      >
        <FormInput
          value={numeric.maxMessages}
          onChange={(value) => editNumber('maxMessages', value)}
        />
      </FormField>
      <FormField
        label="Maximum age in seconds"
        hint="0–3600 whole seconds. A message at this age or older ends the search."
      >
        <FormInput
          value={numeric.delaySeconds}
          onChange={(value) => editNumber('delaySeconds', value)}
        />
      </FormField>
      <Text style={{ color: theme.text2, fontSize: 11 }}>
        Local R9K changes visibility only. It does not enable similarity checking. Hidden similar
        messages never trigger highlights.
      </Text>
      {notice ? <Text style={{ color: theme.text2, fontSize: 12 }}>{notice}</Text> : null}
      <ActionButton
        primary
        disabled={!state.loaded || !dirty || state.saving || Boolean(validation)}
        onClick={() => {
          runUiTask(save())
        }}
      >
        {state.saving
          ? 'Saving…'
          : error || state.error
            ? 'Retry saving similarity settings'
            : 'Save similarity settings'}
      </ActionButton>
    </div>
  )
}
