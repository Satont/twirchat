import { useEffect, useMemo, useRef, useState } from 'react'

import {
  COMMUNITY_BADGE_PROVIDERS,
  type CommunityBadgeProvider,
} from '../../services/community-badges'
import type { EmotePreferences, EmoteProvider } from '../../services/provider-emotes'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useT, type MessageKey } from '../i18n'
import { emoteStore, loadEmotes } from '../state/app'
import { useStore } from '../state/create-store'
import {
  emotePreferencesStore,
  loadEmotePreferences,
  saveEmotePreferences,
} from '../state/emote-preferences'
import { useTheme } from '../theme-context'
import { SettingsFooter } from './settings/SettingsLayout'
import { ActionButton } from './ui/Form'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'

const PROVIDER_LABELS: Record<Exclude<EmoteProvider, 'twitch'>, string> = {
  seventv: '7TV',
  bttv: 'BetterTTV',
  ffz: 'FrankerFaceZ',
}
const COMMUNITY_BADGE_LABELS: Record<CommunityBadgeProvider, MessageKey> = {
  ffzap: 'emoteProviderSettings.communityBadge.ffzap',
  dankchat: 'emoteProviderSettings.communityBadge.dankchat',
  chatsen: 'emoteProviderSettings.communityBadge.chatsen',
  homies: 'emoteProviderSettings.communityBadge.homies',
  twir: 'emoteProviderSettings.communityBadge.twir',
}

/** Section body: edits stay local until the section is saved. */
export function EmoteProviderSettings() {
  const backend = useBackend()
  const theme = useTheme()
  const { t } = useT()
  const state = useStore(emotePreferencesStore)
  const [draft, setDraft] = useState(() => structuredClone(state.value))
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [notice, setNotice] = useState('')
  const [providerErrors, setProviderErrors] = useState<Array<{ url: string; error: string }>>([])
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(state.value),
    [draft, state.value],
  )
  useEffect(() => {
    runUiTask(loadEmotePreferences(backend.api))
    let active = true
    void backend.api
      .getEmoteProviderErrors()
      .then((errors) => {
        if (active) setProviderErrors(errors)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [backend])
  useEffect(() => {
    if (!dirty) setDraft(structuredClone(state.value))
  }, [dirty, state.value])
  const change = (value: EmotePreferences) => {
    setNotice('')
    setDraft(value)
  }
  const save = async (): Promise<boolean> => {
    const snapshot = draft
    try {
      await saveEmotePreferences(backend.api, snapshot)
    } catch {
      /* The preference store exposes the save error below. */
      return false
    }
    try {
      const channels = [...emoteStore.get().keys()]
      await Promise.all(
        channels.flatMap((key) => {
          const separator = key.indexOf(':')
          const platform = key.slice(0, separator)
          const channelId = key.slice(separator + 1)
          if (
            (platform !== 'twitch' && platform !== 'kick' && platform !== 'youtube') ||
            !channelId
          )
            return []
          return [loadEmotes(backend, platform, channelId)]
        }),
      )
      setProviderErrors(await backend.api.getEmoteProviderErrors())
    } catch {
      /* A provider refresh failure does not undo the saved preference. */
    }
    return draftRef.current === snapshot
  }
  const move = (index: number, delta: number) => {
    const order = [...draft.precedence]
    const [provider] = order.splice(index, 1)
    order.splice(index + delta, 0, provider!)
    change({ ...draft, precedence: order })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Text style={{ fontSize: 12, color: theme.text2 }}>{t('emoteProviderSettings.intro')}</Text>
      {draft.precedence.map((provider, index) => (
        <div
          key={provider}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <Text style={{ fontSize: 13, color: theme.text, flexGrow: 1 }}>
            {provider === 'twitch'
              ? t('emoteProviderSettings.provider.twitch')
              : PROVIDER_LABELS[provider]}
          </Text>
          <ActionButton disabled={index === 0} onClick={() => move(index, -1)}>
            {t('emoteProviderSettings.moveUp')}
          </ActionButton>
          <ActionButton
            disabled={index === draft.precedence.length - 1}
            onClick={() => move(index, 1)}
          >
            {t('emoteProviderSettings.moveDown')}
          </ActionButton>
          <Switch
            small
            checked={draft.enabled[provider]}
            onChange={(value) =>
              change({ ...draft, enabled: { ...draft.enabled, [provider]: value } })
            }
          />
        </div>
      ))}
      {(
        [
          ['zeroWidth', 'emoteProviderSettings.zeroWidth'],
          ['modifiers', 'emoteProviderSettings.modifiers'],
          ['personal', 'emoteProviderSettings.personal'],
          ['badges', 'emoteProviderSettings.badges'],
          ['paints', 'emoteProviderSettings.paints'],
          ['emojiCompletion', 'emoteProviderSettings.emojiCompletion'],
        ] satisfies [
          keyof Pick<
            EmotePreferences,
            'zeroWidth' | 'modifiers' | 'personal' | 'badges' | 'paints' | 'emojiCompletion'
          >,
          MessageKey,
        ][]
      ).map(([key, labelKey]) => (
        <div
          key={key}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 13, color: theme.text }}>{t(labelKey)}</Text>
          <Switch
            small
            testId={`emote-preference-${key}`}
            checked={draft[key]}
            onChange={(value) => change({ ...draft, [key]: value })}
          />
        </div>
      ))}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Text style={{ fontSize: 13, color: theme.text }}>
          {t('emoteProviderSettings.communityBadges')}
        </Text>
        <Text style={{ fontSize: 11, color: theme.text2 }}>
          {t('emoteProviderSettings.communityBadgesHint')}
        </Text>
      </div>
      {COMMUNITY_BADGE_PROVIDERS.map((provider) => (
        <div
          key={provider}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 13, color: theme.text }}>
            {t(COMMUNITY_BADGE_LABELS[provider])}
          </Text>
          <Switch
            small
            testId={`community-badge-${provider}`}
            checked={draft.communityBadges[provider]}
            onChange={(value) =>
              change({
                ...draft,
                communityBadges: { ...draft.communityBadges, [provider]: value },
              })
            }
          />
        </div>
      ))}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 13, color: theme.text }}>
            {t('emoteProviderSettings.sharePresence')}
          </Text>
          <Text style={{ fontSize: 11, color: theme.text2 }}>
            {t('emoteProviderSettings.sharePresenceHint')}
          </Text>
        </div>
        <Switch
          small
          checked={draft.sendPresence}
          onChange={(value) => change({ ...draft, sendPresence: value })}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontSize: 12, color: theme.text2, flexGrow: 1 }}>
          {t('emoteProviderSettings.favorites', { count: draft.favorites.length })}
        </Text>
        <ActionButton
          disabled={draft.favorites.length === 0}
          onClick={() => change({ ...draft, favorites: [] })}
        >
          {t('emoteProviderSettings.clearFavorites')}
        </ActionButton>
      </div>
      {providerErrors.slice(0, 3).map(({ url, error }) => (
        <Text key={url} style={{ fontSize: 11, color: theme.warningText }}>
          {t('emoteProviderSettings.providerError', { host: new URL(url).hostname, error })}
        </Text>
      ))}
      <SettingsFooter
        sectionId="emotes"
        dirty={dirty}
        saving={state.saving}
        error={state.error || undefined}
        errorTestId="emotes-save-error"
        note={notice}
        disabled={!state.loaded}
        saveTestId="emotes-save"
        onSave={save}
        onDiscard={() => {
          setDraft(structuredClone(state.value))
          setNotice('')
        }}
      />
    </div>
  )
}
