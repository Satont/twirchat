import { ActionButton } from '@gpuix/components/ui/Form'
import { useT } from '@gpuix/i18n'
import { useTheme } from '@gpuix/theme-context'

import { SectionHeader } from '../UserCardUI'
import type { WhisperSectionProps } from './types'

export function WhisperSection({ target, moderation, bg, onOpenWhispers }: WhisperSectionProps) {
  const theme = useTheme()
  const { t } = useT()
  const { busy } = moderation

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        borderWidth: 1,
        borderRadius: 12,
        borderColor: theme.border,
        paddingTop: 8,
        paddingBottom: 20,
        paddingLeft: 12,
        paddingRight: 12,
        backgroundColor: bg,
      }}
    >
      <SectionHeader icon="twitch" title={t('userCard.whispers.title')} />
      <ActionButton icon="reply" disabled={busy} onClick={() => onOpenWhispers(target)}>
        {t('userCard.actions.whisperTo', { name: target.displayName })}
      </ActionButton>
    </div>
  )
}
