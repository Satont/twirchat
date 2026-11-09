import { useEffect, useMemo, useRef, useState } from 'react'

import {
  validateMessageSimilaritySettings,
  type MessageSimilaritySettings,
} from '../../services/message-similarity'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useT, type MessageKey } from '../i18n'
import { useStore } from '../state/create-store'
import {
  loadMessageSimilaritySettings,
  messageSimilarityPreferences,
  messageSimilarityStore,
} from '../state/message-similarity'
import { useTheme } from '../theme-context'
import { SettingsFooter } from './settings/SettingsLayout'
import { ActionButton, FormField, FormInput } from './ui/Form'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'
const toggles: [keyof MessageSimilaritySettings, MessageKey][] = [
  ['enabled', 'similaritySettings.enabled'],
  ['hideSimilar', 'similaritySettings.hideSimilar'],
  ['sameUserOnly', 'similaritySettings.sameUserOnly'],
  ['excludeOwn', 'similaritySettings.excludeOwn'],
  ['graySimilar', 'similaritySettings.graySimilar'],
  ['shownSimilarTriggerHighlights', 'similaritySettings.shownSimilarTriggerHighlights'],
]
export function SimilaritySettings() {
  const backend = useBackend()
  const theme = useTheme()
  const { t } = useT()
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
  const save = async (): Promise<boolean> => {
    const requested = revision.current
    try {
      await messageSimilarityPreferences.save(backend.api, draft)
      const current = requested === revision.current
      if (current) setDirty(false)
      return current
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Text style={{ color: theme.text2, fontSize: 12 }}>{t('similaritySettings.intro')}</Text>
      {state.error && !dirty ? (
        <ActionButton
          onClick={() => {
            runUiTask(loadMessageSimilaritySettings(backend))
          }}
        >
          {t('similaritySettings.retry')}
        </ActionButton>
      ) : null}
      {toggles.map(([key, labelKey]) => (
        <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Switch checked={Boolean(draft[key])} onChange={(value) => edit(key, value)} />
          <Text style={{ color: theme.text, fontSize: 12 }}>{t(labelKey)}</Text>
        </div>
      ))}
      <FormField
        label={t('similaritySettings.threshold')}
        hint={t('similaritySettings.thresholdHint')}
      >
        <FormInput value={numeric.threshold} onChange={(value) => editNumber('threshold', value)} />
      </FormField>
      <FormField
        label={t('similaritySettings.preceding')}
        hint={t('similaritySettings.precedingHint')}
      >
        <FormInput
          value={numeric.maxMessages}
          onChange={(value) => editNumber('maxMessages', value)}
        />
      </FormField>
      <FormField label={t('similaritySettings.maxAge')} hint={t('similaritySettings.maxAgeHint')}>
        <FormInput
          value={numeric.delaySeconds}
          onChange={(value) => editNumber('delaySeconds', value)}
        />
      </FormField>
      <Text style={{ color: theme.text2, fontSize: 11 }}>{t('similaritySettings.note')}</Text>
      <SettingsFooter
        sectionId="similarity"
        dirty={dirty}
        saving={state.saving}
        error={error || state.error || validation}
        note={notice}
        disabled={!state.loaded || Boolean(validation)}
        saveTestId="similarity-save"
        errorTestId="similarity-save-error"
        onSave={save}
        onDiscard={() => {
          revision.current++
          setDraft(structuredClone(state.value))
          setNumeric({
            threshold: String(state.value.threshold),
            maxMessages: String(state.value.maxMessages),
            delaySeconds: String(state.value.delaySeconds),
          })
          setDirty(false)
          setError('')
          setNotice('')
        }}
      />
    </div>
  )
}
