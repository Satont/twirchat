import { useEffect, useState } from 'react'

import type { EmotePreferences, EmoteProvider } from '../../services/provider-emotes'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { emoteStore, loadEmotes } from '../state/app'
import { useStore } from '../state/create-store'
import {
  emotePreferencesStore,
  loadEmotePreferences,
  saveEmotePreferences,
} from '../state/emote-preferences'
import { useTheme } from '../theme-context'
import { ActionButton, FormError } from './ui/Form'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'

const PROVIDER_LABELS: Record<EmoteProvider, string> = {
  twitch: 'Platform emotes',
  seventv: '7TV',
  bttv: 'BetterTTV',
  ffz: 'FrankerFaceZ',
}

/** Section body: changes persist immediately through the desktop facade. */
export function EmoteProviderSettings() {
  const backend = useBackend()
  const theme = useTheme()
  const state = useStore(emotePreferencesStore)
  const [providerErrors, setProviderErrors] = useState<Array<{ url: string; error: string }>>([])
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
  const patch = (value: EmotePreferences, refresh = true) => {
    void saveEmotePreferences(backend.api, value)
      .then(async () => {
        if (!refresh) return
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
            return [loadEmotes(backend, platform, channelId, false)]
          }),
        )
        setProviderErrors(await backend.api.getEmoteProviderErrors())
      })
      .catch(() => {})
  }
  const move = (index: number, delta: number) => {
    const order = [...state.value.precedence]
    const [provider] = order.splice(index, 1)
    order.splice(index + delta, 0, provider!)
    patch({ ...state.value, precedence: order })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Text style={{ fontSize: 12, color: theme.text2 }}>
        Enabled providers are checked from top to bottom when names collide. Channel emotes win over
        globals within each provider.
      </Text>
      <FormError>{state.error}</FormError>
      {state.value.precedence.map((provider, index) => (
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
            {PROVIDER_LABELS[provider]}
          </Text>
          <ActionButton disabled={index === 0} onClick={() => move(index, -1)}>
            Move up
          </ActionButton>
          <ActionButton
            disabled={index === state.value.precedence.length - 1}
            onClick={() => move(index, 1)}
          >
            Move down
          </ActionButton>
          <Switch
            small
            checked={state.value.enabled[provider]}
            onChange={(value) =>
              patch({ ...state.value, enabled: { ...state.value.enabled, [provider]: value } })
            }
          />
        </div>
      ))}
      {(
        [
          ['zeroWidth', 'Layer zero-width emotes'],
          ['modifiers', 'BTTV / FFZ emote modifiers'],
          ['personal', '7TV personal emotes'],
          ['badges', 'Provider badges'],
          ['paints', '7TV name paints'],
          ['emojiCompletion', 'Emoji shortcode completion'],
        ] satisfies [
          keyof Pick<
            EmotePreferences,
            'zeroWidth' | 'modifiers' | 'personal' | 'badges' | 'paints' | 'emojiCompletion'
          >,
          string,
        ][]
      ).map(([key, label]) => (
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
          <Text style={{ fontSize: 13, color: theme.text }}>{label}</Text>
          <Switch
            small
            checked={state.value[key]}
            onChange={(value) => patch({ ...state.value, [key]: value }, key === 'personal')}
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
          <Text style={{ fontSize: 13, color: theme.text }}>Share active channel with 7TV</Text>
          <Text style={{ fontSize: 11, color: theme.text2 }}>
            Sends your 7TV presence while viewing a channel. Disabled by default.
          </Text>
        </div>
        <Switch
          small
          checked={state.value.sendPresence}
          onChange={(value) => patch({ ...state.value, sendPresence: value }, false)}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text
          style={{ fontSize: 12, color: theme.text2, flexGrow: 1 }}
        >{`${state.value.favorites.length}/250 favorite emotes · ${state.saving ? 'Saving…' : 'Changes saved automatically'}`}</Text>
        <ActionButton
          disabled={state.value.favorites.length === 0}
          onClick={() => patch({ ...state.value, favorites: [] }, false)}
        >
          Clear favorites
        </ActionButton>
      </div>
      {providerErrors.slice(0, 3).map(({ url, error }) => (
        <Text
          key={url}
          style={{ fontSize: 11, color: theme.warningText }}
        >{`${new URL(url).hostname}: ${error}. Other providers remain available.`}</Text>
      ))}
    </div>
  )
}
