import { useGpuixRequired, useWindowSize, type PublicInstance } from '@gpuix/react'
import type { TwitchReward } from '@twirchat/shared/twitch-activities'
import { memo, useEffect, useMemo, useRef, useState } from 'react'

import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useT } from '../hooks/use-translation'
import { useTextInputFocusTracking } from '../state/focus'
import { useOverlayClose } from '../state/overlays'
import { runTwitchActivity, twitchActivitiesStore } from '../state/twitch-activities'
import { useStoreSelector } from '../state/use-store'
import { withAlpha } from '../theme'
import { useTheme } from '../theme-context'
import { ActionButton, FormError, FormField } from './ui/Form'
import { Icon } from './ui/Icon'
import { RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'

interface ChannelPointsControlProps {
  accountId: string
  channelSlug: string
  open: boolean
  onOpen: () => void
  onClose: () => void
}

type Redemption =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; reward: string }

interface RewardsPopupProps {
  channelSlug: string
  balance: number
  rewards: TwitchReward[]
  redemption: Redemption
  onRedeem: (reward: TwitchReward, input: string) => Promise<void>
  onClearFeedback: () => void
  onClose: () => void
  onOutside: () => void
}

const MARGIN = 8
const MAX_WIDTH = 344
const MAX_HEIGHT = 398
const INPUT_LIMIT = 500
const EMPTY_REWARDS: TwitchReward[] = []

export const ChannelPointsControl = memo(function ChannelPointsControl({
  accountId,
  channelSlug,
  open,
  onOpen,
  onClose,
}: ChannelPointsControlProps) {
  const backend = useBackend()
  const theme = useTheme()
  const { language, t, tPlural } = useT()
  const renderer = useGpuixRequired()
  const trigger = useRef<PublicInstance | null>(null)
  const dismissedAt = useRef(0)
  const pending = useRef(false)
  const mounted = useRef(false)
  const [redemption, setRedemption] = useState<Redemption>({ kind: 'idle' })
  const key = channelSlug.toLowerCase()
  const balance = useStoreSelector(twitchActivitiesStore, (channels) => {
    const state = channels.get(key)
    const snapshot = state?.snapshot
    return state?.error || snapshot?.errors.pointsBalance || snapshot?.errors.rewards
      ? undefined
      : snapshot?.pointsBalance
  })
  const rewards = useStoreSelector(
    twitchActivitiesStore,
    (channels) => channels.get(key)?.snapshot?.rewards ?? EMPTY_REWARDS,
  )
  const enabled = useMemo(() => rewards.filter((reward) => reward.isEnabled), [rewards])
  const visible = balance !== undefined && enabled.length > 0

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (open && !visible) onClose()
  }, [open, visible, onClose])

  if (balance === undefined || !enabled.length) return null

  const exact = balance.toLocaleString(language)
  const compact = balance.toLocaleString(language, {
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  const toggle = () => {
    if (Date.now() - dismissedAt.current < 250) return
    if (open) onClose()
    else {
      if (!pending.current) setRedemption({ kind: 'idle' })
      onOpen()
    }
  }
  const dismiss = () => {
    onClose()
    if (trigger.current) renderer.focusElement?.(trigger.current.id)
  }
  const dismissOutside = () => {
    dismissedAt.current = Date.now()
    onClose()
  }
  const redeem = async (reward: TwitchReward, input: string): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setRedemption({ kind: 'pending' })
    try {
      await runTwitchActivity(
        backend,
        {
          action: 'redeem_reward',
          channelSlug,
          rewardId: reward.id,
          rewardTitle: reward.title,
          rewardPrompt: reward.prompt,
          cost: reward.cost,
          input,
        },
        accountId,
      )
      if (mounted.current) setRedemption({ kind: 'success', reward: reward.title })
    } catch (error) {
      if (mounted.current)
        setRedemption({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
    } finally {
      pending.current = false
    }
  }

  return (
    <div style={{ position: 'relative', alignSelf: 'flex-end', flexShrink: 0 }}>
      <div
        ref={trigger}
        testId="channel-points-button"
        role="button"
        tabIndex={0}
        aria-label={t('composer.rewards.open', {
          balance: tPlural('activities.rewards.channelPoints', balance, { count: exact }),
        })}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key !== 'enter' && event.key !== 'space') return
          event.preventDefault()
          event.stopPropagation()
          toggle()
        }}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingLeft: 6,
          paddingRight: 6,
          gap: 4,
          height: 28,
          borderRadius: 6,
          backgroundColor: open ? theme.accent.tint15 : theme.fill,
          cursor: 'pointer',
          hover: { backgroundColor: theme.fillHover },
          focusVisible: { outlineWidth: 1, outlineColor: theme.link },
        }}
      >
        <Icon name="channelPoints" size={15} color={theme.link} />
        <Text style={{ fontSize: 11, fontWeight: 650, color: theme.text }}>{compact}</Text>
      </div>
      {open ? (
        <RewardsPopup
          channelSlug={channelSlug}
          balance={balance}
          rewards={enabled}
          redemption={redemption}
          onRedeem={redeem}
          onClearFeedback={() => {
            if (!pending.current) setRedemption({ kind: 'idle' })
          }}
          onClose={dismiss}
          onOutside={dismissOutside}
        />
      ) : null}
    </div>
  )
})

function RewardsPopup({
  channelSlug,
  balance,
  rewards,
  redemption,
  onRedeem,
  onClearFeedback,
  onClose,
  onOutside,
}: RewardsPopupProps) {
  const theme = useTheme()
  const { language, t, tPlural } = useT()
  const { width, height } = useWindowSize()
  const popupWidth = Math.max(1, Math.min(MAX_WIDTH, width - 2 * MARGIN))
  const popupHeight = Math.max(1, Math.min(MAX_HEIGHT, height - 60))
  const [rewardId, setRewardId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const reward =
    redemption.kind === 'success' ? undefined : rewards.find((entry) => entry.id === rewardId)
  const busy = redemption.kind === 'pending'
  const inputLength = Array.from(input.trim()).length
  const unavailable = reward ? rewardUnavailable(reward, balance, t) : undefined
  const columnCount = popupWidth >= 254 ? 2 : 1
  const tileWidth = Math.max(1, Math.floor((popupWidth - 29 - (columnCount - 1) * 8) / columnCount))

  useOverlayClose(true, onClose)

  const selectReward = (id: string | null) => {
    setRewardId(id)
    setInput('')
    onClearFeedback()
  }

  return (
    <anchored deferred side="top" align="end" gap={MARGIN} fit="snap" snapMargin={MARGIN}>
      <div
        testId="channel-points-popup"
        onMouseDownOutside={onOutside}
        style={{
          width: popupWidth,
          maxHeight: popupHeight,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: theme.surface2,
          borderWidth: 1,
          borderColor: theme.dialogBorder,
          borderRadius: 10,
          boxShadow: {
            offsetX: 0,
            offsetY: 8,
            blurRadius: 24,
            spreadRadius: 0,
            color: '#00000055',
          },
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            padding: 10,
            borderBottomWidth: 1,
            borderColor: theme.border,
            flexShrink: 0,
          }}
        >
          {reward ? (
            <PopupIconButton
              icon="chevronLeft"
              label={t('common.back')}
              testId="channel-points-back"
              onClick={() => selectReward(null)}
            />
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
              {t('composer.rewards.title')}
            </Text>
            <Text style={{ fontSize: 11, color: theme.text2, textOverflow: 'ellipsis' }}>
              {`#${channelSlug}`}
            </Text>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              padding: 5,
              borderRadius: 5,
              backgroundColor: theme.accent.tint15,
            }}
          >
            <Icon name="channelPoints" size={14} color={theme.link} />
            <Text style={{ fontSize: 12, fontWeight: 650, color: theme.text }}>
              {balance.toLocaleString(language)}
            </Text>
          </div>
          <PopupIconButton
            icon="close"
            label={t('common.close')}
            testId="channel-points-close"
            onClick={onClose}
          />
        </div>
        <div
          key={reward?.id ?? 'catalog'}
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: 11,
            gap: 9,
            minHeight: 0,
            flexShrink: 1,
            overflowY: 'scroll',
            scrollbarWidth: 4,
            scrollbarColor: theme.scrollbar,
          }}
        >
          {redemption.kind === 'success' ? (
            <Text
              testId="channel-points-feedback"
              style={{ fontSize: 12, color: theme.successText }}
            >
              {t('composer.rewards.success', { reward: redemption.reward })}
            </Text>
          ) : null}
          {redemption.kind === 'error' ? (
            <div testId="channel-points-error">
              <FormError>{redemption.message}</FormError>
            </div>
          ) : null}
          {busy && !reward ? (
            <Text style={{ fontSize: 12, color: theme.text2 }}>
              {t('composer.rewards.redeeming')}
            </Text>
          ) : null}
          {reward ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <RewardArt reward={reward} size={44} />
                <Text style={{ fontSize: 15, fontWeight: 700, color: theme.text, minWidth: 0 }}>
                  {reward.title}
                </Text>
              </div>
              {reward.prompt ? (
                <Text style={{ fontSize: 12, color: theme.text2 }}>{reward.prompt}</Text>
              ) : null}
              {reward.isInputRequired ? (
                <RewardInput
                  value={input}
                  inputTooLong={inputLength > INPUT_LIMIT}
                  onChange={setInput}
                  onClose={onClose}
                />
              ) : null}
              {unavailable ? (
                <Text style={{ fontSize: 12, color: theme.warningText }}>{unavailable}</Text>
              ) : null}
              <ActionButton
                testId="channel-points-redeem"
                primary
                disabled={
                  busy ||
                  !!unavailable ||
                  (reward.isInputRequired && (!inputLength || inputLength > INPUT_LIMIT))
                }
                onClick={() => {
                  const message = reward.isInputRequired ? input.trim() : ''
                  runUiTask(onRedeem(reward, message))
                }}
                style={{ alignItems: 'center' }}
              >
                {busy
                  ? t('composer.rewards.redeeming')
                  : t('composer.rewards.redeem', {
                      cost: tPlural('activities.rewards.points', reward.cost, {
                        count: reward.cost.toLocaleString(language),
                      }),
                    })}
              </ActionButton>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {rewards.map((entry) => (
                <RewardTile
                  key={entry.id}
                  reward={entry}
                  width={tileWidth}
                  unavailable={!!rewardUnavailable(entry, balance, t)}
                  onClick={() => selectReward(entry.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </anchored>
  )
}

function RewardInput({
  value,
  inputTooLong,
  onChange,
  onClose,
}: {
  value: string
  inputTooLong: boolean
  onChange: (value: string) => void
  onClose: () => void
}) {
  const theme = useTheme()
  const { t } = useT()
  const [focused, setFocused] = useState(false)
  const focus = useTextInputFocusTracking(setFocused)
  const label = t('activities.rewards.redemptionMessage')
  return (
    <FormField label={label}>
      <textarea
        testId="channel-points-input"
        aria-label={label}
        value={value}
        minRows={2}
        maxRows={3}
        {...focus}
        onChange={(event) => onChange(event.value ?? '')}
        onKeyDown={(event) => {
          if (event.key !== 'escape') return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
        theme={{ caret: theme.accent.primary }}
        style={{
          minWidth: 0,
          padding: 7,
          borderWidth: 1,
          borderRadius: 5,
          borderColor: focused ? theme.link : theme.border,
          backgroundColor: theme.surface,
          color: theme.text,
          fontSize: 12,
        }}
      />
      {inputTooLong ? (
        <FormError>{t('composer.rewards.inputLimit', { limit: INPUT_LIMIT })}</FormError>
      ) : null}
    </FormField>
  )
}

function rewardUnavailable(
  reward: TwitchReward,
  balance: number,
  t: ReturnType<typeof useT>['t'],
): string | undefined {
  if (reward.isPaused) return t('composer.rewards.paused')
  if (reward.isInStock === false) return t('composer.rewards.outOfStock')
  return balance < reward.cost ? t('composer.rewards.insufficient') : undefined
}

function RewardTile({
  reward,
  width,
  unavailable,
  onClick,
}: {
  reward: TwitchReward
  width: number
  unavailable: boolean
  onClick: () => void
}) {
  const theme = useTheme()
  const { language, tPlural } = useT()
  const cost = reward.cost.toLocaleString(language)
  return (
    <div
      testId={`channel-points-reward-${reward.id}`}
      role="button"
      tabIndex={0}
      aria-label={`${reward.title} · ${tPlural('activities.rewards.points', reward.cost, { count: cost })}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== 'enter' && event.key !== 'space') return
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      style={{
        width,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        padding: 6,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 7,
        backgroundColor: theme.surface,
        cursor: 'pointer',
        hover: { backgroundColor: theme.fillHover },
        focusVisible: { outlineWidth: 1, outlineColor: theme.link },
      }}
    >
      <RewardArt reward={reward} size={38} wide unavailable={unavailable} />
      <Text
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: theme.text,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {reward.title}
      </Text>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Icon name="channelPoints" size={12} color={unavailable ? theme.text2 : theme.link} />
        <Text style={{ flexGrow: 1, fontSize: 11, color: theme.text2 }}>{cost}</Text>
        {unavailable ? <Icon name="lock" size={12} color={theme.text2} /> : null}
      </div>
    </div>
  )
}

function RewardArt({
  reward,
  size,
  wide = false,
  unavailable = false,
}: {
  reward: TwitchReward
  size: number
  wide?: boolean
  unavailable?: boolean
}) {
  const theme = useTheme()
  const icon = <Icon name="gift" size={20} color={theme.link} />
  return (
    <div
      style={{
        height: size,
        width: wide ? '100%' : size,
        flexShrink: 0,
        borderRadius: 5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: reward.backgroundColor
          ? withAlpha(reward.backgroundColor, unavailable ? 0.18 : 0.52)
          : theme.accent.tint15,
      }}
    >
      {reward.imageUrl ? (
        <RemoteImage url={reward.imageUrl} style={{ width: 24, height: 24 }} fallback={icon} />
      ) : (
        icon
      )}
    </div>
  )
}

function PopupIconButton({
  icon,
  label,
  testId,
  onClick,
}: {
  icon: 'chevronLeft' | 'close'
  label: string
  testId: string
  onClick: () => void
}) {
  const theme = useTheme()
  return (
    <div
      testId={testId}
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== 'enter' && event.key !== 'space') return
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      style={{
        width: 26,
        height: 26,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 5,
        cursor: 'pointer',
        hover: { backgroundColor: theme.fillHover },
        focusVisible: { outlineWidth: 1, outlineColor: theme.link },
      }}
    >
      <Icon name={icon} size={15} color={theme.text2} />
    </div>
  )
}
