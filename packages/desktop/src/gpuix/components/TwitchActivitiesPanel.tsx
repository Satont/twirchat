import type {
  TwitchActivityAction,
  TwitchActivitiesSnapshot,
} from '@twirchat/shared/twitch-activities'
import { useEffect, useRef, useState } from 'react'

import { useBackend, useBackendEvent } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useT, type MessageKey } from '../i18n'
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
const TABS: { id: ActivityTab; labelKey: MessageKey }[] = [
  { id: 'polls', labelKey: 'activities.tab.polls' },
  { id: 'predictions', labelKey: 'activities.tab.predictions' },
  { id: 'pins', labelKey: 'activities.tab.pins' },
  { id: 'rewards', labelKey: 'activities.tab.rewards' },
  { id: 'queue', labelKey: 'activities.tab.queue' },
  { id: 'following', labelKey: 'activities.tab.following' },
  { id: 'whispers', labelKey: 'activities.tab.whispers' },
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
  const { t } = useT()
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
      if (generation === actionGeneration.value) setFeedback(t('activities.feedback.completed'))
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
        <Text style={{ fontSize: 17, fontWeight: 700, color: theme.text, flexGrow: 1 }}>
          {t('activities.header.title', { channel: channelSlug })}
        </Text>
        <ActionButton
          disabled={state.loading || busy}
          onClick={() => void loadTwitchActivities(backend, channelSlug)}
        >
          {t('activities.action.refresh')}
        </ActionButton>
        <ActionButton onClick={onClose}>{t('activities.action.close')}</ActionButton>
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
            {t(entry.labelKey)}
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
          <Text style={{ fontSize: 12, color: theme.text2 }}>{t('activities.loading')}</Text>
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
  const { t, tPlural } = useT()
  const [title, setTitle] = useState('')
  const [choices, setChoices] = useState(() => t('activities.form.defaultChoices'))
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
              <Empty>{`${choice.title} · ${tPlural('activities.polls.votes', choice.votes)}`}</Empty>
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
                {t('activities.polls.vote')}
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
              {t('activities.polls.end')}
            </ActionButton>
            <ActionButton
              disabled={busy || poll.status === 'ACTIVE'}
              onClick={() =>
                void perform({ action: 'archive_poll', channelSlug: channel, pollId: poll.id })
              }
            >
              {t('activities.polls.archive')}
            </ActionButton>
          </Row>
        </div>
      ))}
      {!snapshot?.polls.length ? <Empty>{t('activities.polls.empty')}</Empty> : null}
      <Heading>{t('activities.polls.createHeading')}</Heading>
      <FormField label={t('activities.form.question')}>
        <FormInput value={title} onChange={setTitle} />
      </FormField>
      <FormField label={t('activities.form.choices')} hint={t('activities.form.choicesHint')}>
        <FormInput value={choices} onChange={setChoices} multiline />
      </FormField>
      <Row>
        <FormField label={t('activities.form.duration')}>
          <FormInput value={duration} onChange={setDuration} />
        </FormField>
        <FormField label={t('activities.form.pointsPerExtraVote')}>
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
        {t('activities.form.createPoll')}
      </ActionButton>
    </>
  )
}

function Predictions({ channel, snapshot, busy, perform }: SectionProps) {
  const { t, tPlural } = useT()
  const [title, setTitle] = useState('')
  const [outcomes, setOutcomes] = useState(() => t('activities.form.defaultChoices'))
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
          <FormField label={t('activities.predictions.pointsToPredict')}>
            <FormInput value={points} onChange={setPoints} />
          </FormField>
          {prediction.outcomes.map((outcome) => (
            <Row key={outcome.id}>
              <Empty>{`${outcome.title} · ${tPlural('activities.predictions.points', outcome.points ?? 0)} · ${tPlural('activities.predictions.predictors', outcome.users ?? 0)}`}</Empty>
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
                {t('activities.predictions.predict')}
              </ActionButton>
              <ActionButton
                disabled={busy || !['ACTIVE', 'LOCKED'].includes(prediction.status)}
                primary={winner === outcome.id}
                onClick={() => setWinner(outcome.id)}
              >
                {t('activities.predictions.winning')}
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
              {t('activities.predictions.lock')}
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
              {t('activities.predictions.resolve')}
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
              {t('activities.predictions.cancelRefund')}
            </ActionButton>
          </Row>
        </div>
      ))}
      {!snapshot?.predictions.length ? <Empty>{t('activities.predictions.empty')}</Empty> : null}
      <Heading>{t('activities.predictions.createHeading')}</Heading>
      <FormField label={t('activities.form.question')}>
        <FormInput value={title} onChange={setTitle} />
      </FormField>
      <FormField label={t('activities.form.outcomes')} hint={t('activities.form.outcomesHint')}>
        <FormInput multiline value={outcomes} onChange={setOutcomes} />
      </FormField>
      <FormField label={t('activities.form.predictionWindow')}>
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
        {t('activities.form.createPrediction')}
      </ActionButton>
    </>
  )
}

function Pins({ channel, snapshot, busy, perform }: SectionProps) {
  const { t } = useT()
  const [messageId, setMessageId] = useState('')
  const [duration, setDuration] = useState('1200')
  const validDuration =
    !duration.trim() ||
    (/^\d+$/.test(duration.trim()) && Number(duration) >= 30 && Number(duration) <= 1800)
  return (
    <>
      <FormError>{snapshot?.errors.pinnedMessage}</FormError>
      <FormField
        label={t('activities.pins.durationLabel')}
        hint={t('activities.pins.durationHint')}
      >
        <FormInput value={duration} onChange={setDuration} />
      </FormField>
      <FormError>{validDuration ? '' : t('activities.pins.invalidDuration')}</FormError>
      {snapshot?.pinnedMessage ? (
        <>
          <Heading>
            {snapshot.pinnedMessage.authorName ?? t('activities.pins.pinnedMessage')}
          </Heading>
          <Empty>{snapshot.pinnedMessage.text}</Empty>
          {snapshot.pinnedMessage.expiresAt ? (
            <Empty>
              {t('activities.pins.expires', {
                date: new Date(snapshot.pinnedMessage.expiresAt).toLocaleString(),
              })}
            </Empty>
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
            {t('activities.pins.unpin')}
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
            {t('activities.pins.updateDuration')}
          </ActionButton>
        </>
      ) : (
        <Empty>{t('activities.pins.empty')}</Empty>
      )}
      <FormField label={t('activities.pins.messageId')}>
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
        {t('activities.pins.pin')}
      </ActionButton>
    </>
  )
}

function Rewards({ channel, snapshot, busy, perform }: SectionProps) {
  const theme = useTheme()
  const { t, tPlural } = useT()
  const [input, setInput] = useState('')
  return (
    <>
      <FormError>{snapshot?.errors.rewards}</FormError>
      <FormError>{snapshot?.errors.pointsBalance}</FormError>
      {snapshot?.pointsBalance !== undefined ? (
        <Heading>
          {tPlural('activities.rewards.channelPoints', snapshot.pointsBalance, {
            count: snapshot.pointsBalance.toLocaleString(),
          })}
        </Heading>
      ) : null}
      <FormField
        label={t('activities.rewards.redemptionMessage')}
        hint={t('activities.rewards.redemptionHint')}
      >
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
            <Heading>
              {`${reward.title} · ${tPlural('activities.rewards.points', reward.cost, {
                count: reward.cost.toLocaleString(),
              })}`}
            </Heading>
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
              {t('activities.rewards.redeem')}
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
                {reward.isPaused ? t('activities.rewards.resume') : t('activities.rewards.pause')}
              </ActionButton>
            ) : null}
          </Row>
        </div>
      ))}
      {!snapshot?.rewards.length ? <Empty>{t('activities.rewards.empty')}</Empty> : null}
    </>
  )
}

function Whispers({ channel, busy, perform }: Omit<SectionProps, 'snapshot'>) {
  const { t } = useT()
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
      <Empty>{t('activities.whispers.description')}</Empty>
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
                ? t('activities.whispers.toUser', { user: message.toUserId })
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
              {t('activities.whispers.reply')}
            </ActionButton>
          </div>
        ))}
      </div>
      <FormField label={t('activities.whispers.recipient')}>
        <FormInput
          value={recipient}
          onChange={setRecipient}
          placeholder={t('activities.whispers.recipientPlaceholder')}
        />
      </FormField>
      <FormField label={t('activities.whispers.message')}>
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
        {t('activities.whispers.send')}
      </ActionButton>
    </>
  )
}
