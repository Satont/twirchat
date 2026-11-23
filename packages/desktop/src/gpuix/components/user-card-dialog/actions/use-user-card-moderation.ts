import { useBackend } from '@gpuix/backend/context'
import { resolveModeratorHotkey } from '@gpuix/components/user-card/moderation-hotkeys'
import { useT } from '@gpuix/i18n'
import { usePaneAccountId } from '@gpuix/pane-account-context'
import { applyModerationOutcome } from '@gpuix/state/app'
import { DEFAULT_MODERATION_SETTINGS, type ModerationSettings } from '@twirchat/shared/user-profile'
import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { useEffect, useRef, useState } from 'react'

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
  async function run(
    action: () => Promise<unknown>,
    message: string,
  ): Promise<{ ok: boolean; message: string }> {
    if (busyRef.current) return { ok: false, message: '' }
    busyRef.current = true
    setBusy(true)
    setFeedback('')
    try {
      await action()
      setFeedback(message)
      return { ok: true, message }
    } catch (cause) {
      const error = String(cause)
      setFeedback(error)
      return { ok: false, message: error }
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
