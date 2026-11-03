import { DEFAULT_MODERATION_SETTINGS, type ModerationSettings } from '@twirchat/shared/user-profile'
import { useEffect, useRef, useState } from 'react'

import type { UserCardTarget } from '../../../views/main/utils/chatCommands'
import { useBackend } from '../../backend/context'
import { applyModerationOutcome } from '../../state/app'
import { chatRulesPreferences, chatRulesStore } from '../../state/chat-rules'
import { useStore } from '../../state/create-store'
import { useTheme } from '../../theme-context'
import { ActionButton, FormInput, FormField } from '../ui/Form'
import { Text } from '../ui/Text'
import { resolveModeratorHotkey } from './moderation-hotkeys'

export function useUserCardModeration(target: UserCardTarget) {
  const backend = useBackend()
  const channel = target.channelSlug
  const identity = target.platformUserId
  const available = (target.platform === 'twitch' || target.platform === 'kick') && !!channel
  const [loaded, setLoaded] = useState(false)
  const busyRef = useRef(false)
  const [settings, setSettings] = useState<ModerationSettings>(
    structuredClone(DEFAULT_MODERATION_SETTINGS),
  )
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  useEffect(() => {
    if (!available) return
    let active = true
    backend.api
      .getModerationSettings()
      .then((value) => {
        if (active) {
          setSettings(value)
          setReason(value.defaultReason)
          setLoaded(true)
        }
      })
      .catch((cause: unknown) => {
        if (active) setFeedback(String(cause))
      })
    return () => {
      active = false
    }
  }, [backend, target.platform, target.platformUserId, available])
  async function run(action: () => Promise<unknown>, message: string) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setFeedback('')
    try {
      await action()
      setFeedback(message)
    } catch (cause) {
      setFeedback(String(cause))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  async function command(text: string) {
    if (target.platform !== 'twitch' && target.platform !== 'kick')
      throw new Error('This platform does not support moderation commands.')
    return backend.api.executePlatformCommand({
      platform: target.platform,
      channelSlug: channel || target.username || identity,
      text,
    })
  }
  async function moderate(action: 'ban' | 'timeout' | 'unban', duration?: number) {
    if (!channel) throw new Error('Open this card in a channel to moderate.')
    if (
      action === 'timeout' &&
      (!Number.isSafeInteger(duration) ||
        duration! < (target.platform === 'kick' ? 60 : 1) ||
        duration! > (target.platform === 'kick' ? 604800 : 1209600))
    )
      throw new Error('Invalid timeout duration for this platform.')
    await command(
      `/${action} ${identity}${duration === undefined ? '' : ` ${duration}`}${action === 'unban' || !reason.trim() ? '' : ` ${reason.trim()}`}`,
    )
    if (
      (action === 'ban' || action === 'timeout') &&
      (target.platform === 'twitch' || target.platform === 'kick')
    )
      applyModerationOutcome({
        action,
        platform: target.platform,
        channelId: target.channelId ?? channel,
        targetUserId: identity,
        ...(duration === undefined ? {} : { durationSeconds: duration }),
      })
  }
  const exec = (argument: string) => {
    const action = resolveModeratorHotkey(argument, settings)
    return run(() => moderate(action.action, action.duration), action.message)
  }
  return {
    settings,
    reason,
    setReason,
    busy,
    feedback,
    run,
    command,
    moderate,
    exec,
    available: available && loaded,
  }
}
export type UserCardModeration = ReturnType<typeof useUserCardModeration>

export function UserCardActions({
  target,
  avatarUrl,
  hideAvatar = false,
  moderation,
}: {
  target: UserCardTarget
  avatarUrl?: string
  hideAvatar?: boolean
  moderation: UserCardModeration
}) {
  const backend = useBackend()
  const theme = useTheme()
  const { settings, reason, setReason, busy, feedback, run, command, moderate } = moderation
  const [seconds, setSeconds] = useState('600')
  const [whisper, setWhisper] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const rules = useStore(chatRulesStore)
  const ruleId = `usercard-no-highlight:${target.platform}:${target.platformUserId}`
  const muted = rules.value.ignores.some(
    (rule) =>
      rule.enabled &&
      rule.action === 'suppress-highlights' &&
      rule.platform === target.platform &&
      rule.userId === target.platformUserId,
  )
  const channel = target.channelSlug
  const identity = target.platformUserId
  useEffect(() => {
    void chatRulesPreferences.load(backend.api).catch(() => {})
  }, [backend])
  async function toggleHighlights() {
    await chatRulesPreferences.load(backend.api)
    const current = chatRulesStore.get().value
    const ignores = current.ignores.filter(
      (rule) =>
        !(
          rule.action === 'suppress-highlights' &&
          rule.platform === target.platform &&
          rule.userId === identity
        ),
    )
    if (!muted)
      ignores.push({
        id: ruleId,
        pattern: target.username || identity,
        enabled: true,
        regex: false,
        caseSensitive: false,
        wholeWord: true,
        target: 'user',
        platform: target.platform,
        userId: identity,
        action: 'suppress-highlights',
        placeholder: false,
      })
    await chatRulesPreferences.save(backend.api, { ...current, ignores })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {[
          ['Copy user ID', identity],
          ['Copy name', target.username || target.displayName],
          ['Copy avatar URL', hideAvatar ? undefined : avatarUrl || target.avatarUrl],
        ].map(([label, text]) => (
          <ActionButton
            key={label}
            disabled={!text || busy}
            onClick={() => void run(() => backend.api.copyText({ text: text! }), 'Copied.')}
          >
            {label}
          </ActionButton>
        ))}
        <ActionButton
          disabled={busy || !rules.loaded}
          onClick={() =>
            void run(toggleHighlights, muted ? 'Highlights restored.' : 'Highlights ignored.')
          }
        >
          {muted ? 'Restore highlights' : 'Ignore highlights'}
        </ActionButton>
      </div>
      {target.platform === 'twitch' ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <ActionButton
              disabled={busy}
              onClick={() => void run(() => command(`/block ${identity}`), 'User blocked.')}
            >
              Block
            </ActionButton>
            <ActionButton
              disabled={busy}
              onClick={() => void run(() => command(`/unblock ${identity}`), 'User unblocked.')}
            >
              Unblock
            </ActionButton>
            <ActionButton
              disabled={busy || !target.username}
              onClick={() =>
                void run(
                  () =>
                    backend.api.executeTwitchActivityAction({
                      action: 'follow',
                      channelSlug: target.username!,
                    }),
                  'Following.',
                )
              }
            >
              Follow
            </ActionButton>
            <ActionButton
              disabled={busy || !target.username}
              onClick={() =>
                void run(
                  () =>
                    backend.api.executeTwitchActivityAction({
                      action: 'unfollow',
                      channelSlug: target.username!,
                    }),
                  'Unfollowed.',
                )
              }
            >
              Unfollow
            </ActionButton>
          </div>
          <FormField label={`Whisper to ${target.displayName}`}>
            <FormInput value={whisper} onChange={setWhisper} placeholder="Private message…" />
          </FormField>
          <ActionButton
            disabled={busy || !whisper.trim()}
            onClick={() =>
              void run(async () => {
                await command(`/w ${identity} ${whisper.trim()}`)
                setWhisper('')
              }, 'Whisper submitted to Twitch.')
            }
          >
            Send whisper
          </ActionButton>
        </>
      ) : null}
      {(target.platform === 'twitch' || target.platform === 'kick') && channel ? (
        <>
          <Text style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
            {`Moderate in #${channel}`}
          </Text>
          <FormField label="Reason">
            <FormInput
              value={reason}
              onChange={setReason}
              placeholder="Optional reason (required for warnings)"
            />
          </FormField>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {settings.reasons.map((value) => (
              <ActionButton key={value} disabled={busy} onClick={() => setReason(value)}>
                {value}
              </ActionButton>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {settings.timeouts.map((item, index) => (
              <ActionButton
                key={index}
                disabled={busy || (target.platform === 'kick' && item.seconds < 60)}
                onClick={() =>
                  void run(() => moderate('timeout', item.seconds), `Timed out for ${item.label}.`)
                }
              >
                {item.label}
              </ActionButton>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 6 }}>
            <div style={{ width: 140 }}>
              <FormInput value={seconds} onChange={setSeconds} placeholder="Timeout seconds" />
            </div>
            <ActionButton
              disabled={busy}
              onClick={() =>
                void run(() => moderate('timeout', Number(seconds)), 'Timeout applied.')
              }
            >
              Custom timeout
            </ActionButton>
            <ActionButton
              danger
              disabled={busy}
              onClick={() => void run(() => moderate('ban'), 'User banned.')}
            >
              Ban
            </ActionButton>
            <ActionButton
              disabled={busy}
              onClick={() => void run(() => moderate('unban'), 'Ban or timeout removed.')}
            >
              Unban / untimeout
            </ActionButton>
          </div>
          {target.platform === 'twitch' ? (
            <>
              <ActionButton
                disabled={busy || !reason.trim()}
                onClick={() =>
                  void run(() => command(`/warn ${identity} ${reason.trim()}`), 'Warning issued.')
                }
              >
                Warn
              </ActionButton>
              <ActionButton onClick={() => setAdvanced(!advanced)}>
                {advanced ? 'Hide advanced actions' : 'Roles & suspicious users'}
              </ActionButton>
              {advanced ? (
                <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    ['mod', 'Make moderator'],
                    ['unmod', 'Remove moderator'],
                    ['vip', 'Make VIP'],
                    ['unvip', 'Remove VIP'],
                    ['restrict', 'Restrict'],
                    ['monitor', 'Monitor'],
                    ['unrestrict', 'Remove restriction'],
                    ['unmonitor', 'Stop monitoring'],
                  ].map(([name, label]) => (
                    <ActionButton
                      key={name}
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => command(`/${name} ${identity}`),
                          `${label} accepted by Twitch.`,
                        )
                      }
                    >
                      {label}
                    </ActionButton>
                  ))}
                </div>
              ) : null}
              {advanced ? (
                <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {(
                    [
                      'add_editor',
                      'remove_editor',
                      'assign_lead_moderator',
                      'unassign_lead_moderator',
                    ] satisfies (
                      | 'add_editor'
                      | 'remove_editor'
                      | 'assign_lead_moderator'
                      | 'unassign_lead_moderator'
                    )[]
                  ).map((action) => (
                    <ActionButton
                      key={action}
                      disabled={busy || (action.includes('editor') && !target.username)}
                      onClick={() =>
                        void run(
                          () =>
                            backend.api.executeTwitchActivityAction(
                              action === 'add_editor' || action === 'remove_editor'
                                ? { action, channelSlug: channel, username: target.username! }
                                : { action, channelSlug: channel, userId: identity },
                            ),
                          'Role change accepted by Twitch.',
                        )
                      }
                    >
                      {
                        {
                          add_editor: 'Make editor',
                          remove_editor: 'Remove editor',
                          assign_lead_moderator: 'Make lead moderator',
                          unassign_lead_moderator: 'Remove lead moderator',
                        }[action]
                      }
                    </ActionButton>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
      {feedback ? <Text style={{ fontSize: 12, color: theme.text2 }}>{feedback}</Text> : null}
    </div>
  )
}
