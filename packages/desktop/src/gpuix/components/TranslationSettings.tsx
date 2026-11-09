import type { Platform } from '@twirchat/shared/types'
import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  TranslationSettings as Settings,
  TranslationProvider,
  TranslationLanguage,
  OutgoingTranslationMode,
} from '../../services/translation'
import { TRANSLATION_PROVIDERS, validateTranslationSettings } from '../../services/translation'
import { useBackend } from '../backend/context'
import { useStore } from '../state/create-store'
import {
  applyTranslationSettings,
  loadTranslationSettings,
  translationSettingsStore,
} from '../state/translation'
import { useTheme } from '../theme-context'
import { SettingsFooter } from './settings/SettingsLayout'
import { ActionButton, FormField, FormInput } from './ui/Form'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'

const LABELS: Record<TranslationProvider, string> = {
  'google-free': 'Google (free)',
  'microsoft-free': 'Microsoft (free)',
  deepl: 'DeepL',
  libretranslate: 'LibreTranslate',
  'google-cloud': 'Google Cloud',
  azure: 'Microsoft Azure',
}
export function TranslationSettings() {
  const backend = useBackend()
  const theme = useTheme()
  const state = useStore(translationSettingsStore)
  const [draft, setDraft] = useState<Settings>(() => structuredClone(state.value.settings))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [languages, setLanguages] = useState<TranslationLanguage[]>([])
  const [languageQuery, setLanguageQuery] = useState('')
  const [channelPlatform, setChannelPlatform] = useState<Platform>('twitch')
  const [channelId, setChannelId] = useState('')
  const revision = useRef(0)
  useEffect(() => {
    void loadTranslationSettings(backend).catch(() => {})
  }, [backend])
  useEffect(() => {
    if (!dirty) setDraft(structuredClone(state.value.settings))
  }, [state.value, dirty])
  const change = (update: (settings: Settings) => void) => {
    revision.current++
    setDirty(true)
    setNotice('')
    setError('')
    setDraft((current) => {
      const next = structuredClone(current)
      update(next)
      return next
    })
  }
  const validation = useMemo(() => {
    try {
      validateTranslationSettings(draft)
      return ''
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }
  }, [draft])
  const displayedLanguages = useMemo(
    () =>
      languages
        .filter((language) =>
          `${language.code} ${language.name}`.toLowerCase().includes(languageQuery.toLowerCase()),
        )
        .slice(0, 12),
    [languages, languageQuery],
  )
  async function save(): Promise<boolean> {
    setBusy(true)
    setError('')
    const at = revision.current
    try {
      applyTranslationSettings(await backend.api.saveTranslationSettings(draft))
      const current = at === revision.current
      if (current) setDirty(false)
      return current
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setBusy(false)
    }
  }
  async function credential(remove: boolean) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (remove)
        applyTranslationSettings(
          await backend.api.removeTranslationCredential({ provider: draft.provider }),
        )
      else {
        const key = (await backend.api.readClipboard()).trim()
        if (!key) throw new Error('Copy the API key to the clipboard first.')
        applyTranslationSettings(
          await backend.api.setTranslationCredential({ provider: draft.provider, key }),
        )
      }
      setNotice(
        remove ? 'API key removed.' : 'API key stored encrypted. Its value is never displayed.',
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  async function fetchLanguages() {
    setBusy(true)
    setError('')
    try {
      setLanguages(await backend.api.getTranslationLanguages({ provider: draft.provider }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      testId="translation-settings"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <Text style={{ fontSize: 12, color: theme.text2 }}>
        Translate selected messages, automatically translate incoming chat, or preview a translation
        before sending. Requests go directly to the provider you choose.
      </Text>
      <FormField label="Translation provider">
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {TRANSLATION_PROVIDERS.map((provider) => (
            <ActionButton
              key={provider}
              primary={draft.provider === provider}
              onClick={() => {
                change((next) => {
                  next.provider = provider
                })
                setLanguages([])
              }}
            >
              {LABELS[provider]}
            </ActionButton>
          ))}
        </div>
      </FormField>
      {draft.provider === 'libretranslate' ? (
        <FormField
          label="LibreTranslate server"
          hint="Use HTTPS, or HTTP for a local server on localhost."
        >
          <FormInput
            testId="translation-libre-endpoint"
            value={draft.libreEndpoint}
            onChange={(libreEndpoint) =>
              change((next) => {
                next.libreEndpoint = libreEndpoint
              })
            }
          />
        </FormField>
      ) : null}
      {draft.provider === 'azure' ? (
        <>
          <FormField label="Azure endpoint">
            <FormInput
              testId="translation-azure-endpoint"
              value={draft.azureEndpoint}
              onChange={(azureEndpoint) =>
                change((next) => {
                  next.azureEndpoint = azureEndpoint
                })
              }
            />
          </FormField>
          <FormField
            label="Azure region"
            hint="Use the resource region, for example eastus. Global resources may leave it blank."
          >
            <FormInput
              value={draft.azureRegion}
              onChange={(azureRegion) =>
                change((next) => {
                  next.azureRegion = azureRegion
                })
              }
            />
          </FormField>
        </>
      ) : null}
      {!['google-free', 'microsoft-free'].includes(draft.provider) ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Text style={{ fontSize: 12, color: theme.text }}>
            {state.value.credentials.includes(draft.provider)
              ? 'An encrypted API key is configured for this provider.'
              : draft.provider === 'libretranslate'
                ? 'No API key configured. Self-hosted servers may not require one.'
                : 'No API key configured for this provider.'}
          </Text>
          {draft.provider === 'deepl' ? (
            <Text style={{ fontSize: 11, color: theme.text2 }}>
              DeepL Free keys ending in :fx use the free API endpoint automatically.
            </Text>
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <ActionButton disabled={busy} onClick={() => void credential(false)}>
              {state.value.credentials.includes(draft.provider)
                ? 'Replace key from clipboard'
                : 'Paste key from clipboard'}
            </ActionButton>
            {state.value.credentials.includes(draft.provider) ? (
              <ActionButton disabled={busy} danger onClick={() => void credential(true)}>
                Remove API key
              </ActionButton>
            ) : null}
          </div>
        </div>
      ) : null}
      <FormField
        label="Source language"
        hint="Use auto for detection, a language code or name, or morse."
      >
        <FormInput
          testId="translation-source-language"
          value={draft.sourceLanguage}
          onChange={(sourceLanguage) =>
            change((next) => {
              next.sourceLanguage = sourceLanguage
            })
          }
        />
      </FormField>
      <FormField label="Target language" hint="For example en, ru, German or morse.">
        <FormInput
          testId="translation-target-language"
          value={draft.targetLanguage}
          onChange={(targetLanguage) =>
            change((next) => {
              next.targetLanguage = targetLanguage
            })
          }
        />
      </FormField>
      <ActionButton disabled={busy || dirty} onClick={() => void fetchLanguages()}>
        {draft.provider === 'google-free'
          ? 'Show language suggestions'
          : 'Load supported languages'}
      </ActionButton>
      {dirty ? (
        <Text style={{ fontSize: 11, color: theme.text2 }}>
          Save the connection settings before loading its language list.
        </Text>
      ) : null}
      {languages.length ? (
        <>
          <FormInput
            value={languageQuery}
            onChange={setLanguageQuery}
            placeholder="Find a supported language"
          />
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
            {displayedLanguages.map((language) => (
              <ActionButton
                key={language.code}
                onClick={() =>
                  change((next) => {
                    next.targetLanguage = language.code
                  })
                }
              >{`${language.name} (${language.code})`}</ActionButton>
            ))}
          </div>
        </>
      ) : null}
      <Toggle
        label="Automatically translate incoming messages"
        value={draft.autoIncoming}
        onChange={(value) =>
          change((next) => {
            next.autoIncoming = value
          })
        }
      />
      <Toggle
        label="Recognize Morse before translating"
        value={draft.decodeMorse}
        onChange={(value) =>
          change((next) => {
            next.decodeMorse = value
          })
        }
      />
      <FormField label="Outgoing messages">
        <Mode
          value={draft.outgoingMode}
          onChange={(value) =>
            change((next) => {
              next.outgoingMode = value
            })
          }
        />
      </FormField>
      <Text style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>
        Per-channel overrides
      </Text>
      <Text style={{ fontSize: 11, color: theme.text2 }}>
        Use the channel name or ID shown by its chat source. Blank language fields inherit the
        defaults.
      </Text>
      {draft.channels.map((channel, index) => (
        <div
          key={`${channel.platform}:${channel.channelId}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            paddingTop: 10,
            borderTopWidth: 1,
            borderColor: theme.border,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <Text
              style={{ fontSize: 12, color: theme.text }}
            >{`${channel.platform} / ${channel.channelId}`}</Text>
            <ActionButton
              onClick={() =>
                change((next) => {
                  next.channels.splice(index, 1)
                })
              }
            >
              Remove
            </ActionButton>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
            {(['inherit', 'on', 'off'] satisfies ('inherit' | 'on' | 'off')[]).map((value) => (
              <ActionButton
                key={value}
                primary={
                  (channel.incoming === undefined ? 'inherit' : channel.incoming ? 'on' : 'off') ===
                  value
                }
                onClick={() =>
                  change((next) => {
                    next.channels[index]!.incoming =
                      value === 'inherit' ? undefined : value === 'on'
                  })
                }
              >
                {value === 'inherit' ? 'Incoming: default' : `Incoming: ${value}`}
              </ActionButton>
            ))}
          </div>
          <FormField label="Outgoing mode">
            <Mode
              value={channel.outgoingMode ?? 'inherit'}
              inherited
              onChange={(value) =>
                change((next) => {
                  next.channels[index]!.outgoingMode = value === 'inherit' ? undefined : value
                })
              }
            />
          </FormField>
          <FormField label="Source language override">
            <FormInput
              value={channel.sourceLanguage ?? ''}
              onChange={(value) =>
                change((next) => {
                  next.channels[index]!.sourceLanguage = value
                })
              }
              placeholder="Default source language"
            />
          </FormField>
          <FormField label="Target language override">
            <FormInput
              value={channel.targetLanguage ?? ''}
              onChange={(value) =>
                change((next) => {
                  next.channels[index]!.targetLanguage = value
                })
              }
              placeholder="Default target language"
            />
          </FormField>
        </div>
      ))}
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
        {(['twitch', 'kick', 'youtube'] satisfies Platform[]).map((platform) => (
          <ActionButton
            key={platform}
            primary={channelPlatform === platform}
            onClick={() => setChannelPlatform(platform)}
          >
            {platform}
          </ActionButton>
        ))}
      </div>
      <FormInput
        testId="translation-channel-name"
        value={channelId}
        onChange={setChannelId}
        placeholder="Channel name or ID"
      />
      <ActionButton
        disabled={!channelId.trim()}
        onClick={() => {
          change((next) => {
            next.channels.push({ platform: channelPlatform, channelId: channelId.trim() })
          })
          setChannelId('')
        }}
      >
        Add channel override
      </ActionButton>
      <SettingsFooter
        sectionId="translation"
        dirty={dirty}
        saving={busy}
        error={validation || error || state.error || undefined}
        errorTestId="translation-settings-error"
        note={notice}
        disabled={Boolean(validation)}
        saveTestId="translation-settings-save"
        onSave={save}
        onDiscard={() => {
          revision.current++
          setDraft(structuredClone(state.value.settings))
          setDirty(false)
          setError('')
          setNotice('')
        }}
      >
        {state.error ? (
          <ActionButton
            disabled={busy}
            onClick={() => void loadTranslationSettings(backend, true).catch(() => {})}
          >
            Retry loading settings
          </ActionButton>
        ) : null}
      </SettingsFooter>
    </div>
  )
}
type TranslationModeProps =
  | {
      value: OutgoingTranslationMode
      onChange: (value: OutgoingTranslationMode) => void
      inherited?: false
    }
  | {
      value: OutgoingTranslationMode | 'inherit'
      onChange: (value: OutgoingTranslationMode | 'inherit') => void
      inherited: true
    }
function Mode(props: TranslationModeProps) {
  const { value, inherited } = props
  const onChange = (mode: OutgoingTranslationMode | 'inherit') => {
    if (props.inherited) props.onChange(mode)
    else if (mode !== 'inherit') props.onChange(mode)
  }
  const modes: (OutgoingTranslationMode | 'inherit')[] = inherited
    ? ['inherit', 'off', 'preview', 'send']
    : ['off', 'preview', 'send']
  return (
    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
      {modes.map((mode) => (
        <ActionButton key={mode} primary={value === mode} onClick={() => onChange(mode)}>
          {mode === 'inherit'
            ? 'Default'
            : mode === 'off'
              ? 'Off'
              : mode === 'preview'
                ? 'Preview before sending'
                : 'Translate and send'}
        </ActionButton>
      ))}
    </div>
  )
}
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  const theme = useTheme()
  return (
    <div
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'enter' || event.key === 'space') {
          event.preventDefault()
          onChange(!value)
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      <Text style={{ fontSize: 12, color: theme.text }}>{label}</Text>
      <Switch checked={value} onChange={onChange} />
    </div>
  )
}
