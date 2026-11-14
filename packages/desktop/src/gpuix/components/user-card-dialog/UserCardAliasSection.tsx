import { Text } from '@gpuix/components/ui/Text'
import { runUiTask } from '@gpuix/hooks/run-ui-task'
import { useT } from '@gpuix/i18n'
import { withAlpha } from '@gpuix/theme'
import { useTheme } from '@gpuix/theme-context'

import type { UserCardAliasSectionProps } from './types'
import { GhostButton, InlineButton, SectionHeader, UserCardPanel } from './UserCardUI'
import { accentGlow } from './utils'

export function UserCardAliasSection({
  aliasValue,
  setAliasValue,
  aliasFocused,
  effectiveAlias,
  displayName,
  aliasFocus,
  handleSaveAlias,
  handleRemoveAlias,
  onClose,
  publicChannelError,
  openPublicChannel,
}: UserCardAliasSectionProps) {
  const theme = useTheme()
  const { t } = useT()

  return (
    <UserCardPanel style={{ marginBottom: 16 }}>
      <SectionHeader
        icon="edit"
        title={t('userCard.alias.title')}
        hint={t('userCard.alias.hint')}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <input
          autoFocus
          value={aliasValue}
          placeholder={displayName}
          onChange={(event) => setAliasValue(event.value ?? '')}
          {...aliasFocus}
          onSubmit={() => runUiTask(handleSaveAlias())}
          onKeyDown={(event) => {
            if (event.key === 'escape') onClose()
          }}
          theme={{ caret: theme.link }}
          style={{
            flexGrow: 8,
            flexBasis: 180,
            minWidth: 0,
            minHeight: 38,
            paddingTop: 8,
            paddingBottom: 8,
            paddingLeft: 12,
            paddingRight: 12,
            backgroundColor: theme.surface2,
            borderWidth: 1,
            borderColor: aliasFocused ? theme.accent.primary : theme.border,
            borderRadius: 10,
            fontSize: 13,
            lineHeight: 18,
            color: theme.text,
            boxShadow: aliasFocused ? accentGlow(theme) : undefined,
            focusVisible: {
              outlineWidth: 2,
              outlineColor: theme.accent.primary,
              outlineOffset: 2,
            },
          }}
        />
        <InlineButton
          icon="check"
          onClick={() => runUiTask(handleSaveAlias())}
          style={{
            flexGrow: 1,
            flexBasis: 60,
            paddingLeft: 18,
            paddingRight: 18,
          }}
        >
          {t('common.save')}
        </InlineButton>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 10,
          marginTop: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          {effectiveAlias ? (
            <GhostButton tone="danger" icon="trash" onClick={() => runUiTask(handleRemoveAlias())}>
              {t('userCard.alias.remove')}
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
            justifyContent: 'space-between',
            gap: 8,
            marginTop: 10,
            padding: 10,
            backgroundColor: withAlpha(theme.dangerText, 0.1),
            borderRadius: 10,
            borderWidth: 1,
            borderColor: withAlpha(theme.dangerText, 0.35),
          }}
        >
          <Text style={{ fontSize: 12, color: theme.dangerText }}>{publicChannelError}</Text>
          <InlineButton onClick={() => openPublicChannel()}>{t('common.retry')}</InlineButton>
        </div>
      ) : null}
    </UserCardPanel>
  )
}
