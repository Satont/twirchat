import { useBackend } from '@gpuix/backend/context'
import { ActionButton, FormInput, FormField } from '@gpuix/components/ui/Form'
import { Text } from '@gpuix/components/ui/Text'
import { resolveModeratorHotkey } from '@gpuix/components/user-card/moderation-hotkeys'
import { useT } from '@gpuix/i18n'
import { applyModerationOutcome } from '@gpuix/state/app'
import { chatRulesPreferences, chatRulesStore } from '@gpuix/state/chat-rules'
import { useStore } from '@gpuix/state/create-store'
import { useTheme } from '@gpuix/theme-context'
import { DEFAULT_MODERATION_SETTINGS, type ModerationSettings } from '@twirchat/shared/user-profile'
import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { useEffect, useRef, useState } from 'react'

import { usePaneAccountId } from '../../pane-account-context'

export function useUserCardModeration(target: UserCardTarget) {
  const backend = useBackend()
  const paneAccountId = usePaneAccountId()
  const { t } = useT()
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
      throw new Error(t('userCard.error.platformUnsupported'))
    return backend.api.executePlatformCommand({
      accountId: paneAccountId,
      platform: target.platform,
      channelSlug: channel || target.username || identity,
      text,
    })
  }
  async function moderate(action: 'ban' | 'timeout' | 'unban', duration?: number) {
    if (!channel) throw new Error(t('userCard.error.noChannel'))
    if (
      action === 'timeout' &&
      (!Number.isSafeInteger(duration) ||
        duration! < (target.platform === 'kick' ? 60 : 1) ||
        duration! > (target.platform === 'kick' ? 604800 : 1209600))
    )
      throw new Error(t('userCard.error.invalidTimeout'))
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
  const { t } = useT()
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
          [t('userCard.actions.copyUserId'), identity],
          [t('userCard.actions.copyName'), target.username || target.displayName],
          [
            t('userCard.actions.copyAvatarUrl'),
            hideAvatar ? undefined : avatarUrl || target.avatarUrl,
          ],
        ].map(([label, text]) => (
          <ActionButton
            key={label}
            disabled={!text || busy}
            onClick={() =>
              void run(() => backend.api.copyText({ text: text! }), t('userCard.feedback.copied'))
            }
          >
            {label}
          </ActionButton>
        ))}
        <ActionButton
          disabled={busy || !rules.loaded}
          onClick={() =>
            void run(
              toggleHighlights,
              muted
                ? t('userCard.feedback.highlightsRestored')
                : t('userCard.feedback.highlightsIgnored'),
            )
          }
        >
          {muted ? t('userCard.actions.restoreHighlights') : t('userCard.actions.ignoreHighlights')}
        </ActionButton>
      </div>
      {target.platform === 'twitch' ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <ActionButton
              disabled={busy}
              onClick={() =>
                void run(() => command(`/block ${identity}`), t('userCard.feedback.blocked'))
              }
            >
              {t('userCard.actions.block')}
            </ActionButton>
            <ActionButton
              disabled={busy}
              onClick={() =>
                void run(() => command(`/unblock ${identity}`), t('userCard.feedback.unblocked'))
              }
            >
              {t('userCard.actions.unblock')}
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
                  t('userCard.feedback.following'),
                )
              }
            >
              {t('userCard.actions.follow')}
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
                  t('userCard.feedback.unfollowed'),
                )
              }
            >
              {t('userCard.actions.unfollow')}
            </ActionButton>
          </div>
          <FormField label={t('userCard.actions.whisperTo', { name: target.displayName })}>
            <FormInput
              value={whisper}
              onChange={setWhisper}
              placeholder={t('userCard.actions.whisperPlaceholder')}
            />
          </FormField>
          <ActionButton
            disabled={busy || !whisper.trim()}
            onClick={() =>
              void run(async () => {
                await command(`/w ${identity} ${whisper.trim()}`)
                setWhisper('')
              }, t('userCard.feedback.whisperSent'))
            }
          >
            {t('userCard.actions.sendWhisper')}
          </ActionButton>
        </>
      ) : null}
      {(target.platform === 'twitch' || target.platform === 'kick') && channel ? (
        <>
          <Text style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
            {t('userCard.actions.moderateIn', { channel })}
          </Text>
          <FormField label={t('userCard.actions.reason')}>
            <FormInput
              value={reason}
              onChange={setReason}
              placeholder={t('userCard.actions.reasonPlaceholder')}
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
                  void run(
                    () => moderate('timeout', item.seconds),
                    t('userCard.feedback.timedOut', { duration: item.label }),
                  )
                }
              >
                {item.label}
              </ActionButton>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 6 }}>
            <div style={{ width: 140 }}>
              <FormInput
                value={seconds}
                onChange={setSeconds}
                placeholder={t('userCard.actions.timeoutSeconds')}
              />
            </div>
            <ActionButton
              disabled={busy}
              onClick={() =>
                void run(
                  () => moderate('timeout', Number(seconds)),
                  t('userCard.feedback.timeoutApplied'),
                )
              }
            >
              {t('userCard.actions.customTimeout')}
            </ActionButton>
            <ActionButton
              danger
              disabled={busy}
              onClick={() => void run(() => moderate('ban'), t('userCard.feedback.banned'))}
            >
              {t('userCard.actions.ban')}
            </ActionButton>
            <ActionButton
              disabled={busy}
              onClick={() => void run(() => moderate('unban'), t('userCard.feedback.unbanned'))}
            >
              {t('userCard.actions.unban')}
            </ActionButton>
          </div>
          {target.platform === 'twitch' ? (
            <>
              <ActionButton
                disabled={busy || !reason.trim()}
                onClick={() =>
                  void run(
                    () => command(`/warn ${identity} ${reason.trim()}`),
                    t('userCard.feedback.warningIssued'),
                  )
                }
              >
                {t('userCard.actions.warn')}
              </ActionButton>
              <ActionButton onClick={() => setAdvanced(!advanced)}>
                {advanced ? t('userCard.actions.hideAdvanced') : t('userCard.actions.advanced')}
              </ActionButton>
              {advanced ? (
                <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    ['mod', t('userCard.role.mod')],
                    ['unmod', t('userCard.role.unmod')],
                    ['vip', t('userCard.role.vip')],
                    ['unvip', t('userCard.role.unvip')],
                    ['restrict', t('userCard.role.restrict')],
                    ['monitor', t('userCard.role.monitor')],
                    ['unrestrict', t('userCard.role.unrestrict')],
                    ['unmonitor', t('userCard.role.unmonitor')],
                  ].map(([name, label]) => (
                    <ActionButton
                      key={name}
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => command(`/${name} ${identity}`),
                          t('userCard.feedback.accepted', { action: label }),
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
                          t('userCard.feedback.roleChangeAccepted'),
                        )
                      }
                    >
                      {
                        {
                          add_editor: t('userCard.role.addEditor'),
                          remove_editor: t('userCard.role.removeEditor'),
                          assign_lead_moderator: t('userCard.role.assignLead'),
                          unassign_lead_moderator: t('userCard.role.unassignLead'),
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
