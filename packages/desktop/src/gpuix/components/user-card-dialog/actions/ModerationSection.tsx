import { useActionToast, type ActionClickEvent } from '@gpuix/components/action-toast'
import { FormField, FormInput, ActionButton } from '@gpuix/components/ui/Form'
import { useT } from '@gpuix/i18n'
import type { IconName } from '@gpuix/icons'
import { useTheme } from '@gpuix/theme-context'
import { useState, type ReactNode } from 'react'

import { SectionHeader } from '../UserCardUI'
import { ReasonDropdown } from './ReasonDropdown'
import { TwitchModerationActions } from './TwitchModerationActions'
import type { ModerationSectionProps } from './types'

interface ModerationBlockProps {
  icon: IconName
  title: string
  hint: string
  bg: string
  children: ReactNode
}

function ModerationBlock({ icon, title, hint, bg, children }: ModerationBlockProps) {
  const theme = useTheme()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 12,
        padding: 12,
        backgroundColor: bg,
      }}
    >
      <SectionHeader icon={icon} title={title} hint={hint} />
      {children}
    </div>
  )
}

export function ModerationSection({ target, channel, moderation, bg }: ModerationSectionProps) {
  const { t } = useT()
  const { showToast } = useActionToast()
  const { settings, reason, setReason, busy, run, command, moderate } = moderation
  const [seconds, setSeconds] = useState('600')
  const identity = target.platformUserId

  async function execute(
    action: () => Promise<unknown>,
    message: string,
    event?: ActionClickEvent,
  ) {
    const result = await run(action, message)
    if (!result.ok) showToast(result.message, event)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {target.platform === 'twitch' ? (
        <ModerationBlock
          icon="alert"
          title={t('userCard.moderation.warn.title')}
          hint={t('userCard.moderation.warn.hint')}
          bg={bg}
        >
          <FormField label={t('userCard.actions.reason')}>
            <FormInput
              value={reason}
              onChange={setReason}
              placeholder={t('userCard.actions.reasonPlaceholder')}
            />
          </FormField>
          <ReasonDropdown
            reasons={settings.reasons}
            value={reason}
            onSelect={setReason}
            disabled={busy}
          />
          <ActionButton
            icon="alert"
            disabled={busy || !reason.trim()}
            onClick={(event) =>
              void execute(
                () => command(`/warn ${identity} ${reason.trim()}`),
                t('userCard.feedback.warningIssued'),
                event,
              ).catch(() => {})
            }
          >
            {t('userCard.actions.warn')}
          </ActionButton>
        </ModerationBlock>
      ) : null}

      <ModerationBlock
        icon="clock"
        title={t('userCard.moderation.punish.title')}
        hint={t('userCard.moderation.punish.hint')}
        bg={bg}
      >
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {settings.timeouts.map((item, index) => (
            <ActionButton
              key={index}
              icon="clock"
              disabled={busy || (target.platform === 'kick' && item.seconds < 60)}
              onClick={(event) =>
                void execute(
                  () => moderate('timeout', item.seconds),
                  t('userCard.feedback.timedOut', { duration: item.label }),
                  event,
                ).catch(() => {})
              }
            >
              {item.label}
            </ActionButton>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <div style={{ width: 140 }}>
            <FormInput
              value={seconds}
              onChange={setSeconds}
              placeholder={t('userCard.actions.timeoutSeconds')}
            />
          </div>
          <ActionButton
            icon="clock"
            disabled={busy}
            onClick={(event) =>
              void execute(
                () => moderate('timeout', Number(seconds)),
                t('userCard.feedback.timeoutApplied'),
                event,
              ).catch(() => {})
            }
          >
            {t('userCard.actions.customTimeout')}
          </ActionButton>
          <ActionButton
            icon="lock"
            danger
            disabled={busy}
            onClick={(event) =>
              void execute(() => moderate('ban'), t('userCard.feedback.banned'), event).catch(
                () => {},
              )
            }
          >
            {t('userCard.actions.ban')}
          </ActionButton>
          <ActionButton
            icon="check"
            disabled={busy}
            onClick={(event) =>
              void execute(() => moderate('unban'), t('userCard.feedback.unbanned'), event).catch(
                () => {},
              )
            }
          >
            {t('userCard.actions.unban')}
          </ActionButton>
        </div>
      </ModerationBlock>

      {target.platform === 'twitch' ? (
        <ModerationBlock
          icon="star"
          title={t('userCard.moderation.roles.title')}
          hint={t('userCard.moderation.roles.hint')}
          bg={bg}
        >
          <TwitchModerationActions
            target={target}
            channel={channel}
            moderation={moderation}
            bg={bg}
          />
        </ModerationBlock>
      ) : null}
    </div>
  )
}
