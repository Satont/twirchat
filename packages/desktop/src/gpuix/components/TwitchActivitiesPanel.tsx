import type {
  TwitchActivityAction,
  TwitchActivitiesSnapshot,
} from '@twirchat/shared/twitch-activities'
import { useEffect, useRef, useState } from 'react'

import { useBackend, useBackendEvent } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { accountsStore } from '../state/app'
import { useStore, useStoreSelector } from '../state/create-store'
import {
  EMPTY_ACTIVITIES,
  loadTwitchActivities,
  runTwitchActivity,
  twitchActivitiesStore,
  whispersStore,
  twitchActivityCapabilitiesStore,
  lastWhisperRecipientStore,
  rememberWhisperRecipient,
} from '../state/twitch-activities'
import { useTheme } from '../theme-context'
import { activityCapabilityText } from './twitch-activities/controllers'
import { Following } from './twitch-activities/Following'
import { RewardQueue } from './twitch-activities/RewardQueue'
import { ActionButton, FormError, FormField, FormInput } from './ui/Form'
import { Modal } from './ui/Modal'
import { RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'

type ActivityTab = 'polls' | 'predictions' | 'pins' | 'rewards' | 'queue' | 'following' | 'whispers'
const TABS: { id: ActivityTab; label: string }[] = [
  { id: 'polls', label: 'Polls' },
  { id: 'predictions', label: 'Predictions' },
  { id: 'pins', label: 'Pinned' },
  { id: 'rewards', label: 'Rewards' },
  { id: 'queue', label: 'Reward queue' },
  { id: 'following', label: 'Following' },
  { id: 'whispers', label: 'Whispers' },
]

export function TwitchActivitiesPanel({
  channelSlug,
  onClose,
  initialTab = 'polls',
}: {
  channelSlug: string
  onClose: () => void
  initialTab?: ActivityTab
}) {
  const backend = useBackend()
  useBackendEvent('accounts_changed', ({ platform, identityChanged }) => {
    if (platform === 'twitch' && identityChanged) onClose()
  })
  const theme = useTheme()
  const [tab, setTab] = useState<ActivityTab>(initialTab)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [capabilityError, setCapabilityError] = useState('')
  const actionGeneration = useRef({ value: 0 }).current
  const busyRef = useRef(false)
  const capability = useStoreSelector(twitchActivityCapabilitiesStore, (channels) =>
    channels.get(channelSlug.toLowerCase()),
  )
  const state = useStoreSelector(
    twitchActivitiesStore,
    (channels) => channels.get(channelSlug.toLowerCase()) ?? EMPTY_ACTIVITIES,
  )
  useEffect(() => {
    const generation = ++actionGeneration.value
    let disposed = false
    let subscribed = false
    setBusy(false)
    busyRef.current = false
    setError('')
    setFeedback('')
    setCapabilityError('')
    runUiTask(loadTwitchActivities(backend, channelSlug))
    void backend.api
      .getTwitchActivityCapability({ channelSlug })
      .then((value) => {
        if (!disposed)
          twitchActivityCapabilitiesStore.modify((channels) =>
            new Map(channels).set(channelSlug.toLowerCase(), value),
          )
      })
      .catch((cause: unknown) => {
        if (!disposed) setCapabilityError(String(cause))
      })
    void backend.api
      .watchTwitchActivities({ channelSlug, watch: true })
      .then(() => {
        if (disposed)
          void backend.api.watchTwitchActivities({ channelSlug, watch: false }).catch(() => {})
        else subscribed = true
      })
      .catch((cause: unknown) => {
        if (!disposed) setCapabilityError(String(cause))
      })
    return () => {
      disposed = true
      if (actionGeneration.value === generation) actionGeneration.value++
      if (subscribed)
        void backend.api.watchTwitchActivities({ channelSlug, watch: false }).catch(() => {})
    }
  }, [backend, channelSlug, actionGeneration])
  const perform = async (action: TwitchActivityAction) => {
    if (busyRef.current) return false
    const generation = actionGeneration.value
    busyRef.current = true
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      await runTwitchActivity(backend, action)
      if (generation === actionGeneration.value) setFeedback('Completed.')
      return true
    } catch (cause) {
      if (generation === actionGeneration.value)
        setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      if (generation === actionGeneration.value) {
        setBusy(false)
        busyRef.current = false
      }
    }
  }
  return (
    <Modal width={800} onClose={onClose}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          padding: 16,
          borderBottomWidth: 1,
          borderColor: theme.border,
        }}
      >
        <Text
          style={{ fontSize: 17, fontWeight: 700, color: theme.text, flexGrow: 1 }}
        >{`${channelSlug} · Channel activity`}</Text>
        <ActionButton
          disabled={state.loading || busy}
          onClick={() => void loadTwitchActivities(backend, channelSlug)}
        >
          Refresh
        </ActionButton>
        <ActionButton onClick={onClose}>Close</ActionButton>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 5,
          padding: 10,
          borderBottomWidth: 1,
          borderColor: theme.border,
        }}
      >
        {TABS.map((entry) => (
          <ActionButton
            key={entry.id}
            primary={tab === entry.id}
            onClick={() => {
              setTab(entry.id)
              setError('')
              setFeedback('')
            }}
          >
            {entry.label}
          </ActionButton>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 16,
          maxHeight: 570,
          overflowY: 'scroll',
          scrollbarColor: theme.scrollbar,
          scrollbarWidth: 4,
        }}
      >
        <Text style={{ fontSize: 12, color: theme.text2 }}>
          {activityCapabilityText(capability)}
        </Text>
        <FormError>{capability?.error || (!capability ? capabilityError : '')}</FormError>
        <FormError>{error || state.error}</FormError>
        {feedback ? <Text style={{ fontSize: 12, color: theme.text2 }}>{feedback}</Text> : null}
        {state.loading && !state.snapshot ? (
          <Text style={{ fontSize: 12, color: theme.text2 }}>Loading channel activity…</Text>
        ) : null}
        {tab === 'polls' ? (
          <Polls
            key={channelSlug}
            channel={channelSlug}
            snapshot={state.snapshot}
            busy={busy}
            perform={perform}
          />
        ) : null}
        {tab === 'predictions' ? (
          <Predictions
            key={channelSlug}
            channel={channelSlug}
            snapshot={state.snapshot}
            busy={busy}
            perform={perform}
          />
        ) : null}
        {tab === 'pins' ? (
          <Pins
            key={channelSlug}
            channel={channelSlug}
            snapshot={state.snapshot}
            busy={busy}
            perform={perform}
          />
        ) : null}
        {tab === 'rewards' ? (
          <Rewards
            key={channelSlug}
            channel={channelSlug}
            snapshot={state.snapshot}
            busy={busy}
            perform={perform}
          />
        ) : null}
        {tab === 'queue' ? (
          <RewardQueue key={channelSlug} channel={channelSlug} snapshot={state.snapshot} />
        ) : null}
        {tab === 'following' ? <Following onJoined={onClose} /> : null}
        {tab === 'whispers' ? (
          <Whispers channel={channelSlug} busy={busy} perform={perform} />
        ) : null}
      </div>
    </Modal>
  )
}

interface SectionProps {
  channel: string
  snapshot: TwitchActivitiesSnapshot | null
  busy: boolean
  perform: (action: TwitchActivityAction) => Promise<boolean>
}
function Empty({ children }: { children: string }) {
  const theme = useTheme()
  return <Text style={{ fontSize: 12, color: theme.text2 }}>{children}</Text>
}
function Heading({ children }: { children: string }) {
  const theme = useTheme()
  return <Text style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>{children}</Text>
}
function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 7,
      }}
    >
      {children}
    </div>
  )
}

function Polls({ channel, snapshot, busy, perform }: SectionProps) {
  const [title, setTitle] = useState('')
  const [choices, setChoices] = useState('Yes\nNo')
  const [duration, setDuration] = useState('60')
  const [extra, setExtra] = useState('0')
  return (
    <>
      <FormError>{snapshot?.errors.polls}</FormError>
      {snapshot?.polls.map((poll) => (
        <div
          key={poll.id}
          style={{ display: 'flex', flexDirection: 'column', gap: 7, paddingBottom: 14 }}
        >
          <Heading>{`${poll.title} · ${poll.status}`}</Heading>
          {poll.choices.map((choice) => (
            <Row key={choice.id}>
              <Empty>{`${choice.title} · ${choice.votes} votes`}</Empty>
              <ActionButton
                disabled={busy || poll.status !== 'ACTIVE'}
                onClick={() =>
                  void perform({
                    action: 'vote_poll',
                    channelSlug: channel,
                    pollId: poll.id,
                    choiceId: choice.id,
                  })
                }
              >
                Vote
              </ActionButton>
            </Row>
          ))}
          <Row>
            <ActionButton
              disabled={busy || poll.status !== 'ACTIVE'}
              onClick={() =>
                void perform({ action: 'end_poll', channelSlug: channel, pollId: poll.id })
              }
            >
              End poll
            </ActionButton>
            <ActionButton
              disabled={busy || poll.status === 'ACTIVE'}
              onClick={() =>
                void perform({ action: 'archive_poll', channelSlug: channel, pollId: poll.id })
              }
            >
              Archive
            </ActionButton>
          </Row>
        </div>
      ))}
      {!snapshot?.polls.length ? <Empty>No polls found.</Empty> : null}
      <Heading>Create a poll</Heading>
      <FormField label="Question">
        <FormInput value={title} onChange={setTitle} />
      </FormField>
      <FormField label="Choices" hint="One choice per line, 2–5 choices">
        <FormInput value={choices} onChange={setChoices} multiline />
      </FormField>
      <Row>
        <FormField label="Duration, seconds">
          <FormInput value={duration} onChange={setDuration} />
        </FormField>
        <FormField label="Points per extra vote">
          <FormInput value={extra} onChange={setExtra} />
        </FormField>
      </Row>
      <ActionButton
        primary
        disabled={busy || !title.trim()}
        onClick={() =>
          void perform({
            action: 'create_poll',
            channelSlug: channel,
            title: title.trim(),
            choices: choices
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
            duration: Number(duration),
            pointsPerVote: Number(extra),
          })
        }
      >
        Create poll
      </ActionButton>
    </>
  )
}

function Predictions({ channel, snapshot, busy, perform }: SectionProps) {
  const [title, setTitle] = useState('')
  const [outcomes, setOutcomes] = useState('Yes\nNo')
  const [duration, setDuration] = useState('120')
  const [points, setPoints] = useState('10')
  const [winner, setWinner] = useState<string | null>(null)
  return (
    <>
      <FormError>{snapshot?.errors.predictions}</FormError>
      {snapshot?.predictions.map((prediction) => (
        <div
          key={prediction.id}
          style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 14 }}
        >
          <Heading>{`${prediction.title} · ${prediction.status}`}</Heading>
          <FormField label="Points to predict">
            <FormInput value={points} onChange={setPoints} />
          </FormField>
          {prediction.outcomes.map((outcome) => (
            <Row key={outcome.id}>
              <Empty>{`${outcome.title} · ${outcome.points ?? 0} points · ${outcome.users ?? 0} predictors`}</Empty>
              <ActionButton
                disabled={busy || prediction.status !== 'ACTIVE'}
                onClick={() =>
                  void perform({
                    action: 'place_bet',
                    channelSlug: channel,
                    predictionId: prediction.id,
                    outcomeId: outcome.id,
                    points: Number(points),
                  })
                }
              >
                Predict
              </ActionButton>
              <ActionButton
                disabled={busy || !['ACTIVE', 'LOCKED'].includes(prediction.status)}
                primary={winner === outcome.id}
                onClick={() => setWinner(outcome.id)}
              >
                Winning outcome
              </ActionButton>
            </Row>
          ))}
          <Row>
            <ActionButton
              disabled={busy || prediction.status !== 'ACTIVE'}
              onClick={() =>
                void perform({
                  action: 'lock_prediction',
                  channelSlug: channel,
                  predictionId: prediction.id,
                })
              }
            >
              Lock
            </ActionButton>
            <ActionButton
              disabled={
                busy ||
                !winner ||
                !prediction.outcomes.some((outcome) => outcome.id === winner) ||
                !['ACTIVE', 'LOCKED'].includes(prediction.status)
              }
              onClick={() => {
                if (winner)
                  runUiTask(
                    perform({
                      action: 'resolve_prediction',
                      channelSlug: channel,
                      predictionId: prediction.id,
                      outcomeId: winner,
                    }),
                  )
              }}
            >
              Resolve selected outcome
            </ActionButton>
            <ActionButton
              danger
              disabled={busy || !['ACTIVE', 'LOCKED'].includes(prediction.status)}
              onClick={() =>
                void perform({
                  action: 'cancel_prediction',
                  channelSlug: channel,
                  predictionId: prediction.id,
                })
              }
            >
              Cancel & refund
            </ActionButton>
          </Row>
        </div>
      ))}
      {!snapshot?.predictions.length ? <Empty>No predictions found.</Empty> : null}
      <Heading>Create a prediction</Heading>
      <FormField label="Question">
        <FormInput value={title} onChange={setTitle} />
      </FormField>
      <FormField label="Outcomes" hint="One outcome per line">
        <FormInput multiline value={outcomes} onChange={setOutcomes} />
      </FormField>
      <FormField label="Prediction window, seconds">
        <FormInput value={duration} onChange={setDuration} />
      </FormField>
      <ActionButton
        primary
        disabled={busy || !title.trim()}
        onClick={() =>
          void perform({
            action: 'create_prediction',
            channelSlug: channel,
            title: title.trim(),
            outcomes: outcomes
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
            duration: Number(duration),
          })
        }
      >
        Create prediction
      </ActionButton>
    </>
  )
}

function Pins({ channel, snapshot, busy, perform }: SectionProps) {
  const [messageId, setMessageId] = useState('')
  const [duration, setDuration] = useState('1200')
  const validDuration =
    !duration.trim() ||
    (/^\d+$/.test(duration.trim()) && Number(duration) >= 30 && Number(duration) <= 1800)
  return (
    <>
      <FormError>{snapshot?.errors.pinnedMessage}</FormError>
      <FormField
        label="Pin duration, seconds"
        hint="30–1800; applies from now. Leave blank for the end of the stream."
      >
        <FormInput value={duration} onChange={setDuration} />
      </FormField>
      <FormError>
        {validDuration ? '' : 'Enter a whole number from 30 to 1800, or leave blank.'}
      </FormError>
      {snapshot?.pinnedMessage ? (
        <>
          <Heading>{snapshot.pinnedMessage.authorName ?? 'Pinned message'}</Heading>
          <Empty>{snapshot.pinnedMessage.text}</Empty>
          {snapshot.pinnedMessage.expiresAt ? (
            <Empty>{`Expires ${new Date(snapshot.pinnedMessage.expiresAt).toLocaleString()}`}</Empty>
          ) : null}
          <ActionButton
            disabled={busy}
            onClick={() =>
              void perform({
                action: 'unpin_message',
                channelSlug: channel,
                messageId: snapshot.pinnedMessage!.messageId,
              })
            }
          >
            Unpin message
          </ActionButton>
          <ActionButton
            disabled={busy || !validDuration}
            onClick={() =>
              void perform({
                action: 'update_pin',
                channelSlug: channel,
                messageId: snapshot.pinnedMessage!.messageId,
                ...(duration.trim() ? { duration: Number(duration) } : {}),
              })
            }
          >
            Update pinned duration from now
          </ActionButton>
        </>
      ) : (
        <Empty>No pinned message.</Empty>
      )}
      <FormField label="Message ID">
        <FormInput value={messageId} onChange={setMessageId} />
      </FormField>

      <ActionButton
        primary
        disabled={busy || !messageId.trim() || !validDuration}
        onClick={() =>
          void perform({
            action: 'pin_message',
            channelSlug: channel,
            messageId: messageId.trim(),
            ...(duration.trim() ? { duration: Number(duration) } : {}),
          })
        }
      >
        Pin message
      </ActionButton>
    </>
  )
}

function Rewards({ channel, snapshot, busy, perform }: SectionProps) {
  const theme = useTheme()
  const [input, setInput] = useState('')
  return (
    <>
      <FormError>{snapshot?.errors.rewards}</FormError>
      <FormError>{snapshot?.errors.pointsBalance}</FormError>
      {snapshot?.pointsBalance !== undefined ? (
        <Heading>{`${snapshot.pointsBalance.toLocaleString()} channel points`}</Heading>
      ) : null}
      <FormField label="Redemption message" hint="Used by rewards that require text">
        <FormInput multiline value={input} onChange={setInput} />
      </FormField>
      {snapshot?.rewards.map((reward) => (
        <div
          key={reward.id}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            padding: 10,
            borderBottomWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Row>
            {reward.imageUrl ? (
              <RemoteImage url={reward.imageUrl} style={{ width: 32, height: 32 }} />
            ) : null}
            <Heading>{`${reward.title} · ${reward.cost.toLocaleString()} points`}</Heading>
          </Row>
          {reward.prompt ? <Empty>{reward.prompt}</Empty> : null}
          <Row>
            <ActionButton
              disabled={
                busy ||
                !reward.isEnabled ||
                reward.isPaused ||
                (reward.isInputRequired && !input.trim()) ||
                (snapshot.pointsBalance !== undefined && snapshot.pointsBalance < reward.cost)
              }
              onClick={() =>
                void perform({
                  action: 'redeem_reward',
                  channelSlug: channel,
                  rewardId: reward.id,
                  rewardTitle: reward.title,
                  cost: reward.cost,
                  input: input.trim(),
                })
              }
            >
              Redeem
            </ActionButton>
            {reward.manageable ? (
              <ActionButton
                disabled={busy}
                onClick={() =>
                  void perform({
                    action: 'update_reward',
                    channelSlug: channel,
                    rewardId: reward.id,
                    patch: { isPaused: !reward.isPaused },
                  })
                }
              >
                {reward.isPaused ? 'Resume reward' : 'Pause reward'}
              </ActionButton>
            ) : null}
          </Row>
        </div>
      ))}
      {!snapshot?.rewards.length ? <Empty>No rewards available.</Empty> : null}
    </>
  )
}

function Whispers({ channel, busy, perform }: Omit<SectionProps, 'snapshot'>) {
  const messages = useStore(whispersStore)
  const ownUserId = useStoreSelector(
    accountsStore,
    (accounts) => accounts.find((account) => account.platform === 'twitch')?.platformUserId,
  )
  const theme = useTheme()
  const [recipient, setRecipient] = useState(lastWhisperRecipientStore.get() ?? '')
  const [text, setText] = useState('')
  return (
    <>
      <Empty>Private messages received during this session.</Empty>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxHeight: 300,
          overflowY: 'scroll',
        }}
      >
        {messages.map((message) => (
          <div
            key={message.id}
            style={{ borderBottomWidth: 1, borderColor: theme.border, paddingBottom: 6 }}
          >
            <Heading>
              {message.fromUserId === ownUserId
                ? `To user ${message.toUserId}`
                : message.fromDisplayName || message.fromLogin}
            </Heading>
            <Empty>{message.text}</Empty>
            <ActionButton
              onClick={() => {
                const username =
                  message.fromUserId === ownUserId
                    ? message.toUserId
                    : message.fromLogin || message.fromDisplayName
                setRecipient(username)
                rememberWhisperRecipient(username)
              }}
            >
              Reply
            </ActionButton>
          </div>
        ))}
      </div>
      <FormField label="Recipient">
        <FormInput value={recipient} onChange={setRecipient} placeholder="Twitch username" />
      </FormField>
      <FormField label="Message">
        <FormInput multiline value={text} onChange={setText} />
      </FormField>
      <ActionButton
        primary
        disabled={busy || !recipient.trim() || !text.trim()}
        onClick={() =>
          void perform({
            action: 'send_whisper',
            channelSlug: channel,
            username: recipient.trim(),
            text: text.trim(),
          }).then((accepted) => {
            if (accepted) {
              rememberWhisperRecipient(recipient)
              setText('')
            }
          })
        }
      >
        Send whisper
      </ActionButton>
    </>
  )
}
