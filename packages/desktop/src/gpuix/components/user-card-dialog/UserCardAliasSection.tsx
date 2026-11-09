import { ActionButton } from '@gpuix/components/ui/Form'
import { Icon } from '@gpuix/components/ui/Icon'
import { Text } from '@gpuix/components/ui/Text'
import { useT } from '@gpuix/i18n'
import type { DesktopWindows } from '@gpuix/state/desktop-windows'
import type { useTextInputFocusTracking } from '@gpuix/state/focus'
import { useTheme } from '@gpuix/theme-context'
import type { UserCardTarget } from '@views/main/utils/chatCommands'

import { GhostButton, InlineButton } from './UserCardUI'

interface UserCardAliasSectionProps {
  aliasValue: string
  setAliasValue: (value: string) => void
  effectiveAlias: string | undefined
  displayName: string
  aliasFocus: ReturnType<typeof useTextInputFocusTracking>
  handleSaveAlias: () => Promise<void>
  handleRemoveAlias: () => Promise<void>
  pinned: boolean
  togglePin: () => void
  onClose: () => void
  windows: DesktopWindows | null
  standalone: boolean
  target: UserCardTarget
  openingWindow: boolean
  setOpeningWindow: (value: boolean) => void
  showNotice: (kind: 'error' | 'info' | 'success', text: string, durationMs?: number) => void
  publicChannelError: string | null
  openPublicChannel: () => void
}

export function UserCardAliasSection({
  aliasValue,
  setAliasValue,
  effectiveAlias,
  displayName,
  aliasFocus,
  handleSaveAlias,
  handleRemoveAlias,
  pinned,
  togglePin,
  onClose,
  windows,
  standalone,
  target,
  openingWindow,
  setOpeningWindow,
  showNotice,
  publicChannelError,
  openPublicChannel,
}: UserCardAliasSectionProps) {
  const theme = useTheme()
  const { t } = useT()

  return (
    <div
      style={{
        marginBottom: 16,
        padding: 16,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            backgroundColor: theme.accent.primary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon name="edit" size={14} color={theme.accent.onPrimary} />
        </div>
        <div>
          <Text
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: theme.text,
            }}
          >
            {t('userCard.alias.title')}
          </Text>
          <Text style={{ fontSize: 11, color: theme.text2 }}>{t('userCard.alias.hint')}</Text>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          gap: 8,
          alignItems: 'stretch',
        }}
      >
        <input
          autoFocus
          value={aliasValue}
          placeholder={displayName}
          onChange={(event) => setAliasValue(event.value ?? '')}
          {...aliasFocus}
          onSubmit={() => void handleSaveAlias()}
          onKeyDown={(event) => {
            if (event.key === 'escape') onClose()
          }}
          theme={{ caret: theme.link }}
          style={{
            flexGrow: 1,
            minWidth: 0,
            paddingTop: 6,
            paddingBottom: 10,
            paddingLeft: 14,
            paddingRight: 14,
            backgroundColor: theme.surface2,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 8,
            fontSize: 14,
            lineHeight: 20,
            color: theme.text,
          }}
        />
        <div
          onClick={() => void handleSaveAlias()}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            minWidth: 125,
            paddingLeft: 20,
            backgroundColor: theme.accent.primary,
            borderRadius: 8,
            cursor: 'pointer',
            flexShrink: 0,
            hover: { opacity: 0.9 },
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: 600, color: theme.accent.onPrimary }}>
            {t('common.save')}
          </Text>
          <Icon name="check" size={14} color={theme.accent.onPrimary} />
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginTop: 12,
          borderRadius: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div
            onClick={togglePin}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingTop: 6,
              paddingBottom: 6,
              paddingLeft: 10,
              paddingRight: 12,
              backgroundColor: pinned ? theme.accent.tint15 : theme.surface2,
              borderWidth: 1,
              borderColor: pinned ? theme.accent.primary : theme.border,
              borderRadius: 6,
              cursor: 'pointer',
              hover: {
                backgroundColor: pinned ? theme.accent.tint25 : theme.fillHover,
              },
            }}
          >
            <Icon name="pin" size={13} color={pinned ? theme.accent.primary : theme.text2} />
            <Text
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: pinned ? theme.accent.primary : theme.text,
              }}
            >
              {pinned ? t('userCard.unpin') : t('userCard.pin')}
            </Text>
          </div>
          {effectiveAlias ? (
            <ActionButton
              danger
              onClick={() => void handleRemoveAlias()}
              style={{
                minWidth: 110,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {t('userCard.alias.remove')}
            </ActionButton>
          ) : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {windows && !standalone ? (
            <GhostButton
              disabled={openingWindow}
              onClick={() => {
                setOpeningWindow(true)
                void windows
                  .openUser(target)
                  .then(onClose)
                  .catch((error) => {
                    setOpeningWindow(false)
                    showNotice('error', String(error))
                  })
              }}
            >
              {openingWindow ? t('userCard.opening') : t('userCard.openInWindow')}
            </GhostButton>
          ) : null}
        </div>
      </div>

      {publicChannelError ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginTop: 10,
            padding: 10,
            backgroundColor: 'rgba(252, 165, 165, 0.15)',
            borderRadius: 8,
            borderWidth: 1,
            borderColor: theme.dangerText,
          }}
        >
          <Text style={{ fontSize: 12, color: theme.dangerText }}>{publicChannelError}</Text>
          <InlineButton onClick={() => openPublicChannel()}>{t('common.retry')}</InlineButton>
        </div>
      ) : null}
    </div>
  )
}
