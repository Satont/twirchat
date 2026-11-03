import type { TwitchActivitiesSnapshot } from '@twirchat/shared/twitch-activities'
import { useEffect, useState } from 'react'

import { useBackend } from '../../backend/context'
import { runUiTask } from '../../hooks/run-ui-task'
import { useStore } from '../../state/create-store'
import { accent } from '../../theme'
import { useTheme } from '../../theme-context'
import { ActionButton, FormError } from '../ui/Form'
import { Text } from '../ui/Text'
import { createRewardQueueController, MAX_QUEUE_ITEMS } from './controllers'

export function RewardQueue({
  channel,
  snapshot,
}: {
  channel: string
  snapshot: TwitchActivitiesSnapshot | null
}) {
  const backend = useBackend()
  const theme = useTheme()
  const [queue] = useState(() => createRewardQueueController(backend.api, channel))
  const state = useStore(queue.store)
  const [confirm, setConfirm] = useState<'FULFILLED' | 'CANCELED' | null>(null)
  const busy = state.loading || state.mutating
  useEffect(() => {
    runUiTask(queue.summary())
    runUiTask(queue.load())
    return () => queue.dispose()
  }, [queue])
  useEffect(() => {
    setConfirm(null)
  }, [state.rewardId, state.order])
  const rewards = state.summary?.rewards ?? snapshot?.rewards ?? []
  const total = state.summary?.rewards.reduce((sum, reward) => sum + reward.pendingCount, 0)
  const selectedTitle = confirm === 'CANCELED' ? 'Reject and refund' : 'Complete'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Text style={{ color: theme.text2, fontSize: 12 }}>
        Review unfulfilled redemptions. The all-rewards queue requires a saved Twitch web session
        with moderation access.
      </Text>
      <FormError>{state.error}</FormError>
      {state.feedback ? (
        <Text style={{ color: theme.text, fontSize: 12 }}>{state.feedback}</Text>
      ) : null}
      {state.summaryError ? (
        <Text style={{ color: theme.text2, fontSize: 12 }}>Queue counts: {state.summaryError}</Text>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <ActionButton
          primary={!state.rewardId}
          disabled={state.mutating}
          onClick={() => queue.selectReward('')}
        >
          All rewards{total === undefined ? '' : ` (${total})`}
        </ActionButton>
        {rewards.map((reward) => (
          <ActionButton
            key={reward.id}
            primary={reward.id === state.rewardId}
            disabled={state.mutating}
            onClick={() => queue.selectReward(reward.id)}
          >
            {reward.title}
            {'pendingCount' in reward ? ` (${reward.pendingCount})` : ''}
          </ActionButton>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <ActionButton
          primary={state.order === 'NEWEST'}
          disabled={state.mutating}
          onClick={() => queue.setOrder('NEWEST')}
        >
          Newest first
        </ActionButton>
        <ActionButton
          primary={state.order === 'OLDEST'}
          disabled={state.mutating}
          onClick={() => queue.setOrder('OLDEST')}
        >
          Oldest first
        </ActionButton>
        <ActionButton
          disabled={busy}
          onClick={() => {
            runUiTask(queue.summary())
            runUiTask(queue.load())
          }}
        >
          Refresh
        </ActionButton>
        <ActionButton disabled={busy || !state.items.length} onClick={() => queue.selectLoaded()}>
          Select loaded
        </ActionButton>
        <ActionButton
          disabled={busy || !state.selected.size}
          onClick={() => queue.clearSelection()}
        >
          Clear selection
        </ActionButton>
      </div>
      <Text style={{ color: theme.text2, fontSize: 12 }}>
        {state.items.length} loaded · {state.selected.size} selected
        {state.loading ? ' · Loading…' : state.mutating ? ' · Applying changes…' : ''}
      </Text>
      {state.items.length ? (
        <virtual-list
          key={`${state.rewardId}:${state.order}`}
          alignment="top"
          estimatedItemHeight={76}
          style={{ height: 320, minHeight: 0, scrollbarColor: theme.scrollbar, scrollbarWidth: 4 }}
        >
          {state.items.map((item) => (
            <div
              key={item.id}
              tabIndex={state.mutating ? undefined : 0}
              onClick={() => queue.toggle(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'enter' || event.key === 'space') {
                  event.preventDefault()
                  queue.toggle(item.id)
                }
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                gap: 4,
                padding: 8,
                borderRadius: 5,
                cursor: state.mutating ? 'default' : 'pointer',
                backgroundColor: state.selected.has(item.id) ? accent.tint20 : theme.fill,
              }}
            >
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: 600 }}>
                {state.selected.has(item.id) ? '✓ ' : ''}
                {item.userName} · {new Date(item.redeemedAt).toLocaleString()}
              </Text>
              {!state.rewardId ? (
                <Text style={{ color: theme.text2, fontSize: 12 }}>
                  {rewards.find((reward) => reward.id === item.rewardId)?.title ?? item.rewardId}
                </Text>
              ) : null}
              <Text style={{ color: theme.text2, fontSize: 12 }}>{item.input || 'No message'}</Text>
            </div>
          ))}
        </virtual-list>
      ) : null}
      {!state.items.length && !busy && !state.error ? (
        <Text style={{ color: theme.text2, fontSize: 12 }}>No unfulfilled redemptions.</Text>
      ) : null}
      {state.cursor ? (
        <div style={{ display: 'flex', flexDirection: 'row', gap: 6 }}>
          <ActionButton
            disabled={busy || state.items.length >= MAX_QUEUE_ITEMS}
            onClick={() => void queue.load('more')}
          >
            Load more
          </ActionButton>
          <ActionButton
            disabled={busy || state.items.length >= MAX_QUEUE_ITEMS}
            onClick={() => void queue.load('all')}
          >
            Load all remaining
          </ActionButton>
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 6 }}>
        <ActionButton
          disabled={busy || !state.selected.size}
          onClick={() => setConfirm('FULFILLED')}
        >
          Complete selected
        </ActionButton>
        <ActionButton
          danger
          disabled={busy || !state.selected.size}
          onClick={() => setConfirm('CANCELED')}
        >
          Reject & refund selected
        </ActionButton>
      </div>
      {confirm ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 10,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 6,
          }}
        >
          <Text style={{ color: theme.text, fontSize: 13 }}>
            {selectedTitle} {state.selected.size} selected redemptions? Confirmed batches are
            removed; failed batches remain selected for retry.
          </Text>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 6 }}>
            <ActionButton
              primary
              disabled={busy || !state.selected.size}
              onClick={() => {
                const status = confirm
                setConfirm(null)
                runUiTask(queue.update(status))
              }}
            >
              Confirm
            </ActionButton>
            <ActionButton disabled={busy} onClick={() => setConfirm(null)}>
              Back
            </ActionButton>
          </div>
        </div>
      ) : null}
    </div>
  )
}
