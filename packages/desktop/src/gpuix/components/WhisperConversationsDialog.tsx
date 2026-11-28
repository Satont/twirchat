import type { TwitchWhisper } from '@twirchat/shared/twitch-activities'
import type { UserCardTarget } from '@views/main/utils/chatCommands'
import { useEffect, useMemo, useState } from 'react'

import { useT } from '../hooks/use-translation'
import { accountsStore } from '../state/accounts'
import { avatarRevisionStore, avatarUrlForUser, ensureAvatarForUser } from '../state/caches'
import { whisperContactsStore, whispersStore } from '../state/twitch-activities'
import { useStore, useStoreSelector } from '../state/use-store'
import { useTheme } from '../theme-context'
import { FormInput } from './ui/Form'
import { Modal } from './ui/Modal'
import { RemoteImage } from './ui/RemoteImage'
import { Text } from './ui/Text'
import { ProfileAvatarFallback } from './user-card-dialog/user-profile/ProfileAvatarFallback'

interface WhisperConversationsDialogProps {
  channelSlug?: string
  onClose: () => void
  onOpen: (target: UserCardTarget) => void
}

interface WhisperConversation {
  userId: string
  login: string
  displayName: string
  avatarUrl?: string
  last: TwitchWhisper
}

export function WhisperConversationsDialog({
  channelSlug,
  onClose,
  onOpen,
}: WhisperConversationsDialogProps) {
  const theme = useTheme()
  const { t } = useT()
  const contacts = useStore(whisperContactsStore)
  const whispers = useStore(whispersStore)
  useStore(avatarRevisionStore)
  const ownUserId = useStoreSelector(
    accountsStore,
    (accounts) => accounts.find((account) => account.platform === 'twitch')?.platformUserId,
  )
  const [query, setQuery] = useState('')

  const items = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return contacts
      .filter((contact) => contact.userId !== ownUserId)
      .flatMap((contact) => {
        const last = whispers.findLast(
          (message) => message.fromUserId === contact.userId || message.toUserId === contact.userId,
        )
        return last ? [{ ...contact, last }] : []
      })
      .filter(
        (item) =>
          !search ||
          item.displayName.toLocaleLowerCase().includes(search) ||
          item.login.toLocaleLowerCase().includes(search),
      )
      .toSorted((a, b) => b.last.at.localeCompare(a.last.at))
  }, [contacts, ownUserId, query, whispers])

  useEffect(() => {
    for (const item of items) ensureAvatarForUser('twitch', item.userId, item.login)
  }, [items])

  const open = (item: WhisperConversation) => {
    onOpen({
      platform: 'twitch',
      platformUserId: item.userId,
      username: item.login,
      displayName: item.displayName,
      avatarUrl: item.avatarUrl,
      channelSlug,
    })
  }

  return (
    <Modal width={420} onClose={onClose} hotkeyContextId="whispers">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          width: '100%',
          height: '100%',
          padding: 12,
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
          {t('userCard.whispers.title')}
        </Text>
        <FormInput value={query} onChange={setQuery} placeholder={t('userCard.whispers.search')} />
        <div
          style={{
            flexGrow: 1,
            minHeight: 0,
            maxHeight: 480,
            overflowY: 'scroll',
            scrollbarColor: theme.scrollbar,
            scrollbarWidth: 5,
          }}
        >
          {items.length ? (
            items.map((item) => (
              <div
                key={item.userId}
                role="button"
                tabIndex={0}
                onClick={() => open(item)}
                onKeyDown={(event) => {
                  if (event.key === 'enter' || event.key === 'space') {
                    event.preventDefault()
                    open(item)
                  }
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingTop: 8,
                  paddingBottom: 8,
                  paddingLeft: 6,
                  paddingRight: 6,
                  borderBottomWidth: 1,
                  borderColor: theme.divider,
                  cursor: 'pointer',
                  hover: { backgroundColor: theme.fillHover },
                }}
              >
                <div style={{ width: 32, height: 32, borderRadius: 16, overflow: 'hidden' }}>
                  <RemoteImage
                    url={item.avatarUrl ?? avatarUrlForUser('twitch', item.userId)}
                    objectFit="cover"
                    thumbnailSize={64}
                    style={{ width: 32, height: 32, borderRadius: 12 }}
                    fallback={<ProfileAvatarFallback name={item.displayName} size={32} />}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <Text style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>
                    {item.displayName}
                  </Text>
                  <Text style={{ fontSize: 11, color: theme.text2 }}>{item.last.text}</Text>
                </div>
              </div>
            ))
          ) : (
            <Text style={{ padding: 12, fontSize: 12, color: theme.text2 }}>
              {t('userCard.whispers.empty')}
            </Text>
          )}
        </div>
      </div>
    </Modal>
  )
}
