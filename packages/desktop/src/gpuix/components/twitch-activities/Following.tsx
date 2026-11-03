import { useEffect, useRef, useState } from 'react'

import { useBackend } from '../../backend/context'
import { runUiTask } from '../../hooks/run-ui-task'
import { useStore } from '../../state/create-store'
import { useTheme } from '../../theme-context'
import { ActionButton, FormError } from '../ui/Form'
import { Text } from '../ui/Text'
import { createFollowingController } from './controllers'
import { joinFollowedChannel } from './join-channel'

export function Following({ onJoined }: { onJoined: () => void }) {
  const backend = useBackend()
  const theme = useTheme()
  const [controller] = useState(() => createFollowingController(backend.api))
  const state = useStore(controller.store)
  const [joining, setJoining] = useState('')
  const mounted = useRef(true)
  const [error, setError] = useState('')
  useEffect(() => {
    runUiTask(controller.load(true))
    return () => {
      mounted.current = false
      controller.dispose()
    }
  }, [controller])
  async function join(login: string) {
    if (joining) return
    setJoining(login)
    setError('')
    try {
      await joinFollowedChannel(backend.api, login)
      if (mounted.current) onJoined()
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setJoining('')
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 6 }}>
        <ActionButton primary={state.liveOnly} onClick={() => void controller.load(true)}>
          Live
        </ActionButton>
        <ActionButton primary={!state.liveOnly} onClick={() => void controller.load(false)}>
          All followed
        </ActionButton>
        <ActionButton disabled={state.loading} onClick={() => void controller.load(state.liveOnly)}>
          Refresh
        </ActionButton>
      </div>
      <FormError>{error || state.error}</FormError>
      {state.loading ? (
        <Text style={{ color: theme.text2, fontSize: 12 }}>Loading followed channels…</Text>
      ) : null}
      {state.page?.channels.length ? (
        <virtual-list
          key={String(state.liveOnly)}
          alignment="top"
          estimatedItemHeight={100}
          style={{ height: 340, minHeight: 0, scrollbarColor: theme.scrollbar, scrollbarWidth: 4 }}
        >
          {state.page?.channels.map((channel) => (
            <div
              key={channel.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                gap: 6,
                paddingBottom: 10,
                borderBottomWidth: 1,
                borderColor: theme.border,
              }}
            >
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: 600 }}>
                {channel.isLive ? 'LIVE · ' : ''}
                {channel.displayName}
                {channel.viewerCount === undefined ? '' : ` · ${channel.viewerCount} viewers`}
              </Text>
              {channel.title ? (
                <Text style={{ color: theme.text2, fontSize: 12 }}>{channel.title}</Text>
              ) : null}
              {channel.categoryName ? (
                <Text style={{ color: theme.text2, fontSize: 12 }}>{channel.categoryName}</Text>
              ) : null}
              <div style={{ display: 'flex', flexDirection: 'row', gap: 6 }}>
                <ActionButton disabled={!!joining} onClick={() => void join(channel.login)}>
                  {joining === channel.login ? 'Joining…' : 'Join chat'}
                </ActionButton>
                <ActionButton
                  onClick={() =>
                    void backend.api
                      .openExternalUrl({
                        url: `https://www.twitch.tv/${encodeURIComponent(channel.login)}`,
                      })
                      .catch((cause: unknown) => setError(String(cause)))
                  }
                >
                  Open stream
                </ActionButton>
              </div>
            </div>
          ))}
        </virtual-list>
      ) : null}
      {state.page?.cursor ? (
        <ActionButton
          disabled={state.loading}
          onClick={() => void controller.load(state.liveOnly, true)}
        >
          Load more
        </ActionButton>
      ) : null}
      {!state.page?.channels.length && !state.loading && !state.error ? (
        <Text style={{ color: theme.text2, fontSize: 12 }}>No channels found.</Text>
      ) : null}
    </div>
  )
}
