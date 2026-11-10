import { useWindowSize } from '@gpuix/react'
import type { WatchedChannel, WatchedPaneSource } from '@twirchat/shared/types'
import { useMemo, useRef, useState } from 'react'

import { MAX_FEED_SOURCES } from '../../views/main/utils/layout-tree'
import { sanitizeDisplayText } from '../../views/shared/utils/display-text'
import {
  isPluginPlatform,
  isPluginWatchedChannel,
  type WatchedPlatform,
} from '../../watched-channels/plugin-channel-types'
import { useBackend } from '../backend/context'
import { usePopupHotkeys } from '../hooks/use-popup-hotkeys'
import { useT } from '../i18n'
import { watchedChannelsStore } from '../state/app'
import { useStore } from '../state/create-store'
import { useTextInputFocusTracking } from '../state/focus'
import { useTheme } from '../theme-context'
import { AddChannelForm } from './AddChannelForm'
import { ActionButton, FormError } from './ui/Form'
import { Icon, PlatformIcon } from './ui/Icon'
import { Modal } from './ui/Modal'
import { Text } from './ui/Text'

type NewSource = Pick<WatchedChannel, 'platform' | 'channelSlug'>
type SourceDraft =
  | { kind: 'saved'; source: WatchedPaneSource }
  | { kind: 'new'; channel: NewSource }

const platformLabels: Record<WatchedChannel['platform'], string> = {
  twitch: 'Twitch',
  kick: 'Kick',
  youtube: 'YouTube',
  vkplay: 'VK Play Live',
}
const noSources: readonly WatchedPaneSource[] = []

function sourceKey(channel: NewSource): string {
  return `${channel.platform}:${channel.channelSlug}`
}

function availableSources(
  drafts: ReadonlyMap<string, SourceDraft>,
  channels: ReadonlyMap<string, WatchedChannel>,
): Map<string, SourceDraft> {
  return new Map(
    [...drafts].filter(([, draft]) => draft.kind === 'new' || channels.has(draft.source.channelId)),
  )
}

export function FeedSourcesModal({
  initialSources = noSources,
  editing = false,
  onSave,
  onClose,
}: {
  initialSources?: readonly WatchedPaneSource[]
  editing?: boolean
  onSave: (sources: WatchedPaneSource[]) => Promise<unknown>
  onClose: () => void
}) {
  const { api } = useBackend()
  const { t } = useT()
  const theme = useTheme()
  const { height } = useWindowSize()
  const watched = useStore(watchedChannelsStore)
  const saved = useMemo(() => {
    const channels = new Map<string, WatchedChannel>()
    for (const channel of watched)
      if (!isPluginWatchedChannel(channel)) channels.set(channel.id, channel)
    return channels
  }, [watched])
  const [selection, setSelection] = useState<ReadonlyMap<string, SourceDraft>>(() => {
    const sources = new Map<string, SourceDraft>()
    for (const source of initialSources) {
      const channel = saved.get(source.channelId)
      if (channel) sources.set(sourceKey(channel), { kind: 'saved', source })
    }
    return sources
  })
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const queryFocus = useTextInputFocusTracking()
  const inFlight = useRef(false)
  const selected = useMemo(() => availableSources(selection, saved), [selection, saved])
  const atLimit = selected.size >= MAX_FEED_SOURCES
  const canSave = !adding && !saving && selected.size >= (editing ? 1 : 2)
  const close = () => {
    if (!inFlight.current) onClose()
  }
  const cancelAdd = () => {
    setAdding(false)
    setError('')
  }
  const popupContextId = usePopupHotkeys('feed-sources', {
    reject: adding ? cancelAdd : close,
  })

  const chooseSource = (key: string, draft: SourceDraft) => {
    if (inFlight.current) return
    setSelection((current) => {
      const next = availableSources(current, saved)
      if (next.delete(key)) return next
      return next.size < MAX_FEED_SOURCES ? next.set(key, draft) : current
    })
    setError('')
  }

  const addChannel = (platform: WatchedPlatform, channelSlug: string) => {
    if (atLimit || inFlight.current || isPluginPlatform(platform)) return
    const channel = { platform, channelSlug }
    const key = sourceKey(channel)
    if (selected.has(key)) {
      setError(t('app.feed.alreadySelected'))
      return
    }
    const existing = [...saved.values()].find((candidate) => sourceKey(candidate) === key)
    const source = existing
      ? (initialSources.find((candidate) => candidate.channelId === existing.id) ?? {
          channelId: existing.id,
        })
      : undefined
    setSelection((current) => {
      const next = availableSources(current, saved)
      if (next.has(key) || next.size >= MAX_FEED_SOURCES) return current
      return next.set(key, source ? { kind: 'saved', source } : { kind: 'new', channel })
    })
    setQuery('')
    cancelAdd()
  }

  const save = async () => {
    if (!canSave || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setError('')
    try {
      const drafts = [...selected.values()]
      const sources = await Promise.all(
        drafts.map(async (draft) => {
          if (draft.kind === 'saved') return draft.source
          const channel = await api.addWatchedChannel(draft.channel)
          return { channelId: channel.id }
        }),
      )
      if (drafts.some((draft) => draft.kind === 'new'))
        watchedChannelsStore.set(await api.getWatchedChannels())
      await onSave(sources)
      onClose()
    } catch (cause) {
      setError(t('app.feed.saveFailed', { error: sanitizeDisplayText(String(cause)) }))
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  const row = (id: string, channel: NewSource, name: string, draft: SourceDraft, first = false) => {
    const key = sourceKey(channel)
    const platform = platformLabels[channel.platform]
    const checked = selected.has(key)
    const disabled = saving || (atLimit && !checked)
    return (
      <div
        key={id}
        testId={`feed-source-${id}`}
        role="checkbox"
        aria-label={`${name} · ${platform}`}
        aria-checked={checked}
        autoFocus={first && !adding}
        tabIndex={disabled ? undefined : 0}
        onClick={() => chooseSource(key, draft)}
        onKeyDown={(event) => {
          if (event.key !== 'enter' && event.key !== 'space') return
          event.preventDefault()
          event.stopPropagation()
          chooseSource(key, draft)
        }}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: 8,
          flexShrink: 0,
          borderRadius: 6,
          backgroundColor: checked ? theme.accent.tint15 : undefined,
          cursor: disabled ? 'default' : 'pointer',
          hover: disabled ? undefined : { backgroundColor: theme.fillHover },
          focusVisible: { outlineWidth: 1, outlineColor: theme.link, outlineOffset: -2 },
        }}
      >
        <PlatformIcon platform={channel.platform} size={15} />
        <Text
          style={{
            color: theme.text,
            fontSize: 13,
            fontWeight: checked ? 600 : 400,
            flexGrow: 1,
            minWidth: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {name}
        </Text>
        <Text style={{ fontSize: 11, color: theme.text2, flexShrink: 0 }}>{platform}</Text>
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: checked ? theme.accent.primary : theme.text2,
            backgroundColor: checked ? theme.accent.primary : undefined,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {checked ? <Icon name="check" size={12} color={theme.accent.onPrimary} /> : null}
        </div>
      </div>
    )
  }

  const search = query.trim().toLowerCase()
  const visibleSaved = [...saved.values()].filter(
    (channel) =>
      selected.get(sourceKey(channel))?.kind !== 'new' &&
      (!search ||
        `${channel.displayName} ${channel.channelSlug} ${platformLabels[channel.platform]}`
          .toLowerCase()
          .includes(search)),
  )
  const added = [...selected.values()].filter((draft) => draft.kind === 'new')
  const hasChoices = added.length + visibleSaved.length > 0
  const focusOutline = { outlineWidth: 1, outlineColor: theme.link, outlineOffset: -2 }

  return (
    <Modal width={440} onClose={close} hotkeyContextId={popupContextId}>
      <div
        testId="feed-editor"
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          maxHeight: Math.min(500, Math.floor(height * 0.85) - 2),
        }}
      >
        <div
          style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}
        >
          <Text style={{ fontSize: 16, fontWeight: 650, color: theme.text }}>
            {t(editing ? 'app.feed.editTitle' : 'app.feed.createTitle')}
          </Text>
          <Text style={{ fontSize: 12, color: theme.text2 }}>{t('app.feed.description')}</Text>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            flexShrink: 1,
            overflowY: 'scroll',
            scrollbarColor: theme.scrollbar,
            scrollbarWidth: 4,
            paddingLeft: 16,
            paddingRight: 16,
            paddingBottom: 12,
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: theme.text, fontSize: 12, fontWeight: 600, flexGrow: 1 }}>
              {t('app.feed.selectedCount', { count: selected.size })}
            </Text>
            {adding ? null : (
              <ActionButton
                testId="feed-add-source"
                disabled={atLimit || saving}
                onClick={() => {
                  setError('')
                  setAdding(true)
                }}
                style={{ focusVisible: focusOutline }}
              >
                {t('app.feed.addChannel')}
              </ActionButton>
            )}
          </div>
          {adding ? (
            <AddChannelForm
              builtInOnly
              cancelable
              confirmLabel={t('app.feed.addToSelection')}
              onConfirm={addChannel}
              onCancel={cancelAdd}
            />
          ) : null}
          {saved.size > 7 ? (
            <input
              testId="feed-source-search"
              value={query}
              aria-label={t('app.feed.search')}
              placeholder={t('app.feed.search')}
              {...queryFocus}
              onChange={(event) => setQuery(event.value ?? '')}
              onKeyDown={(event) => {
                if (event.key !== 'escape') return
                event.preventDefault()
                event.stopPropagation()
                close()
              }}
              theme={{ caret: theme.accent.primary }}
              style={{
                backgroundColor: theme.surface2,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 6,
                color: theme.text,
                padding: 7,
                fontSize: 12,
                focusVisible: focusOutline,
              }}
            />
          ) : null}
          {hasChoices ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
                padding: 3,
                gap: 2,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 8,
                backgroundColor: theme.surface2,
              }}
            >
              {added.map((draft) =>
                row(
                  `new-${sourceKey(draft.channel)}`,
                  draft.channel,
                  sanitizeDisplayText(draft.channel.channelSlug),
                  draft,
                ),
              )}
              {visibleSaved.map((channel, index) =>
                row(
                  channel.id,
                  channel,
                  sanitizeDisplayText(channel.displayName),
                  {
                    kind: 'saved',
                    source: initialSources.find((source) => source.channelId === channel.id) ?? {
                      channelId: channel.id,
                    },
                  },
                  index === 0 && !search,
                ),
              )}
            </div>
          ) : (
            <Text style={{ fontSize: 12, color: theme.text2, paddingTop: 4 }}>
              {t(search ? 'app.feed.noMatches' : 'app.feed.noChannels')}
            </Text>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            gap: 8,
            borderTopWidth: 1,
            borderColor: theme.border,
            padding: 12,
          }}
        >
          <FormError>{error}</FormError>
          {atLimit || (!editing && selected.size < 2) ? (
            <Text style={{ fontSize: 11, color: theme.text2 }}>
              {atLimit
                ? t('app.feed.maxSources', { count: MAX_FEED_SOURCES })
                : t('app.feed.chooseTwo')}
            </Text>
          ) : null}
          <div
            style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 6 }}
          >
            <ActionButton
              testId="feed-cancel"
              disabled={saving}
              onClick={close}
              style={{ focusVisible: focusOutline }}
            >
              {t('common.cancel')}
            </ActionButton>
            <ActionButton
              testId="feed-save"
              disabled={!canSave}
              primary
              onClick={() => void save()}
              style={{ focusVisible: focusOutline }}
            >
              {saving
                ? t('common.saving')
                : editing
                  ? t('app.feed.saveSources')
                  : t('app.feed.create')}
            </ActionButton>
          </div>
        </div>
      </div>
    </Modal>
  )
}
