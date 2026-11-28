import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { useEffect, useMemo, useState } from 'react'

import { useBackend } from '../backend-context'
import { useT } from '../hooks/use-translation'
import { accountsStore } from '../state/accounts'
import { avatarRevisionStore, avatarUrlForUser, ensureAvatarForUser } from '../state/caches'
import { useOverlayClose } from '../state/overlays'
import {
  rememberSentWhisper,
  rememberWhisperContact,
  whispersStore,
} from '../state/twitch-activities'
import { useStore, useStoreSelector } from '../state/use-store'
import { useTheme } from '../theme-context'
import { ActionButton, FormInput } from './ui/Form'
import { Icon } from './ui/Icon'
import { RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'
import { Badge } from './user-card-dialog/Badge'
import { ProfileAvatarFallback } from './user-card-dialog/user-profile/ProfileAvatarFallback'

interface WhisperThreadPanelProps {
  target: UserCardTarget
  onClose: () => void
}

export function WhisperThreadPanel({ target, onClose }: WhisperThreadPanelProps) {
  const theme = useTheme()
  const { t } = useT()
  const backend = useBackend()
  const whispers = useStore(whispersStore)
  useStore(avatarRevisionStore)
  const ownUserId = useStoreSelector(
    accountsStore,
    (accounts) => accounts.find((account) => account.platform === 'twitch')?.platformUserId,
  )
  const ownDisplayName = useStoreSelector(
    accountsStore,
    (accounts) => accounts.find((account) => account.platform === 'twitch')?.displayName,
  )
  const ownUsername = useStoreSelector(
    accountsStore,
    (accounts) => accounts.find((account) => account.platform === 'twitch')?.username,
  )
  const badge = target.badges?.[0]
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  useOverlayClose(true, onClose)

  useEffect(() => {
    if (target.platformUserId === ownUserId) return
    rememberWhisperContact(backend.api, {
      userId: target.platformUserId,
      login: target.username ?? target.displayName,
      displayName: target.displayName,
      avatarUrl: target.avatarUrl,
    })
  }, [
    backend.api,
    ownUserId,
    target.avatarUrl,
    target.displayName,
    target.platformUserId,
    target.username,
  ])

  useEffect(() => {
    if (target.platformUserId !== ownUserId)
      ensureAvatarForUser('twitch', target.platformUserId, target.username ?? target.displayName)
  }, [ownUserId, target.displayName, target.platformUserId, target.username])

  async function submit() {
    const message = text.trim()
    if (!message || sending) return
    setSending(true)
    setError('')
    try {
      await backend.api.executeTwitchActivityAction({
        action: 'send_whisper',
        channelSlug: target.channelSlug ?? ownUsername ?? '',
        username: target.username ?? target.displayName,
        text: message,
      })
      rememberSentWhisper(backend.api, {
        toUserId: target.platformUserId,
        toLogin: target.username ?? target.displayName,
        displayName: target.displayName,
        text: message,
      })
      setText('')
    } catch (cause) {
      setError(String(cause))
    } finally {
      setSending(false)
    }
  }

  const conversation = useMemo(
    () =>
      whispers.filter(
        (message) => message.fromUserId === ownUserId && message.toUserId === target.platformUserId,
      ),
    [ownUserId, target.platformUserId, whispers],
  )

  return (
    <div
      testId="whisper-thread-panel"
      role="region"
      aria-label={target.displayName}
      style={{
        position: 'absolute',
        right: 4,
        bottom: 0,
        width: '98%',
        maxWidth: 480,
        height: '68%',
        maxHeight: 340,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: theme.bg,
        borderWidth: 1,
        borderColor: theme.dialogBorder,
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          flexShrink: 0,
          paddingLeft: 12,
          paddingRight: 6,
          paddingTop: 3,
          paddingBottom: 3,
          borderBottomWidth: 1,
          borderColor: theme.divider,
          backgroundColor: theme.surface2,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            flexGrow: 1,
            minWidth: 0,
          }}
        >
          <Icon name="reply" size={13} color={theme.text2} />
          <div style={{ width: 24, height: 24, borderRadius: 12, overflow: 'hidden' }}>
            <RemoteImage
              url={target.avatarUrl ?? avatarUrlForUser('twitch', target.platformUserId)}
              objectFit="cover"
              thumbnailSize={48}
              style={{ width: 24, height: 24, borderRadius: 12 }}
              fallback={<ProfileAvatarFallback name={target.displayName} size={24} />}
            />
          </div>
          <Text style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>
            {target.displayName}
          </Text>
          {badge ? <Badge badge={badge} size={16} /> : null}
        </div>
        <div
          testId="whisper-thread-close"
          role="button"
          aria-label={t('common.close')}
          tabIndex={0}
          onClick={onClose}
          onKeyDown={(event) => {
            if (event.key === 'enter' || event.key === 'space') {
              event.preventDefault()
              onClose()
            }
          }}
          style={{
            width: 26,
            height: 26,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
            cursor: 'pointer',
            hover: { backgroundColor: theme.fillHover },
          }}
        >
          <Icon name="close" size={14} color={theme.text2} />
        </div>
      </div>
      <div
        style={{
          flexGrow: 1,
          minHeight: 0,
          overflowY: 'scroll',
          scrollbarColor: theme.scrollbar,
          scrollbarWidth: 5,
        }}
      >
        {conversation.length ? (
          conversation.map((message) => (
            <div
              key={message.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                paddingTop: 8,
                paddingBottom: 8,
                paddingLeft: 12,
                paddingRight: 12,
                borderBottomWidth: 1,
                borderColor: theme.divider,
              }}
            >
              <Text style={{ fontSize: 12, color: theme.text, whiteSpace: 'normal' }}>
                {`${ownDisplayName ?? ''}: ${message.text}`}
              </Text>
            </div>
          ))
        ) : (
          <Text style={{ padding: 12, fontSize: 12, color: theme.text2 }}>
            {t('userCard.whisper.noMessages')}
          </Text>
        )}
      </div>
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: 6,
          borderTopWidth: 1,
          borderColor: theme.divider,
        }}
      >
        {error ? <Text style={{ fontSize: 11, color: theme.dangerText }}>{error}</Text> : null}
        <div style={{ display: 'flex', flexDirection: 'row', gap: 6 }}>
          <div style={{ flexGrow: 1, minWidth: 0 }}>
            <FormInput
              value={text}
              onChange={setText}
              onSubmit={() => void submit().catch(() => {})}
              placeholder={t('userCard.actions.whisperPlaceholder')}
            />
          </div>
          <ActionButton
            icon="send"
            disabled={sending || !text.trim()}
            onClick={() => void submit().catch(() => {})}
          >
            {t('userCard.actions.sendWhisper')}
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
