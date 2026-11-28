import { useBackend } from '@gpuix/backend/context'
import { useActionToast } from '@gpuix/components/action-toast'
import { ActionButton } from '@gpuix/components/ui/Form'
import { useT } from '@gpuix/hooks/use-translation'
import type { IconName } from '@gpuix/icons'
import { chatRulesPreferences, chatRulesStore } from '@gpuix/state/chat-rules'
import { useStore } from '@gpuix/state/use-store'
import { useTheme } from '@gpuix/theme-context'
import { useEffect } from 'react'

import { SectionHeader } from '../UserCardUI'
import type { ActiveActionsSectionProps } from './types'

export function ActiveActionsSection({ target, moderation, bg }: ActiveActionsSectionProps) {
  const backend = useBackend()
  const { showToast } = useActionToast()
  const theme = useTheme()
  const { t } = useT()
  const { run, busy } = moderation
  const rules = useStore(chatRulesStore)
  const identity = target.platformUserId
  const ruleId = `usercard-no-highlight:${target.platform}:${identity}`
  const muted = rules.value.ignores.some(
    (rule) =>
      rule.enabled &&
      rule.action === 'suppress-highlights' &&
      rule.platform === target.platform &&
      rule.userId === identity,
  )

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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexBasis: 220,
        flexShrink: 1,
        flexGrow: 1,
        minWidth: 200,
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
      <SectionHeader icon="users" title={t('userCard.actions.active')} />

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 4,
        }}
      >
        {(
          [
            { label: t('userCard.actions.copyUserId'), text: identity, icon: 'copy' },
            {
              label: t('userCard.actions.copyName'),
              text: target.username || target.displayName,
              icon: 'copy',
            },
          ] satisfies Array<{ label: string; text: string | undefined; icon: IconName }>
        ).map(({ label, text, icon }) => (
          <ActionButton
            key={label}
            icon={icon}
            style={{
              flexShrink: 1,
              flexGrow: 1,
              flexBasis: 0,
            }}
            disabled={!text || busy}
            onClick={(event) => {
              if (!text) return
              void run(() => backend.api.copyText({ text }), t('userCard.feedback.copied')).catch(
                () => {},
              )
              showToast(t('userCard.feedback.copied'), event)
            }}
          >
            {label}
          </ActionButton>
        ))}
        <ActionButton
          icon="eye"
          active={muted}
          style={{
            flexShrink: 1,
            flexGrow: 1,
            flexBasis: 0,
          }}
          disabled={busy || !rules.loaded}
          onClick={(event) => {
            const message = muted
              ? t('userCard.feedback.highlightsRestored')
              : t('userCard.feedback.highlightsIgnored')
            void run(toggleHighlights, message).catch(() => {})
            showToast(message, event)
          }}
        >
          {muted ? t('userCard.actions.restoreHighlights') : t('userCard.actions.ignoreHighlights')}
        </ActionButton>
      </div>
    </div>
  )
}
