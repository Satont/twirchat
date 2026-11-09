import { memo } from 'react'

import { sanitizeDisplayText, truncateGraphemes } from '../../views/shared/utils/display-text'
import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useStoreSelector } from '../state/create-store'
import { decideTwitchAutoModMessage, twitchAutoModStore } from '../state/twitch-automod'
import { semantic, withAlpha } from '../theme'
import { useTheme } from '../theme-context'
import { ActionButton } from './ui/Form'
import { Icon } from './ui/Icon'
import { Text } from './ui/Text'

export const TwitchAutoMod = memo(function TwitchAutoMod({
  channelSlug,
  hideBlockedTerms,
}: {
  channelSlug: string
  hideBlockedTerms?: boolean
}) {
  const { api } = useBackend()
  const theme = useTheme()
  const channel = channelSlug.toLowerCase()
  const held = useStoreSelector(twitchAutoModStore, (queues) => queues.get(channel)?.held)
  if (!held) return null
  const message = held.values().next().value
  if (!message) return null

  const { messageId, displayName, text } = message.hold
  const displayText =
    hideBlockedTerms && message.hold.blockedTerm ? '[blocked-term message hidden]' : text
  const pending = message.state === 'deciding'
  return (
    <div
      testId="twitch-automod"
      style={{
        flexShrink: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        paddingTop: 6,
        paddingBottom: 7,
        paddingLeft: 12,
        paddingRight: 12,
        borderTopWidth: 1,
        borderColor: withAlpha(semantic.warning, 0.42),
        backgroundColor: withAlpha(semantic.warning, theme.isLight ? 0.09 : 0.12),
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 4,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Icon name="alert" size={13} color={theme.warningText} />
          <Text style={{ fontSize: 12, fontWeight: 700, color: theme.text }}>AutoMod</Text>
          <Text style={{ fontSize: 11, color: theme.warningText }}>
            {pending ? 'Submitting…' : `${held.size} held`}
          </Text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 5 }}>
          <ActionButton
            testId="twitch-automod-approve"
            disabled={pending}
            onClick={() =>
              runUiTask(
                decideTwitchAutoModMessage(api, {
                  channelSlug: channel,
                  messageId,
                  decision: 'approve',
                }),
              )
            }
          >
            Approve
          </ActionButton>
          <ActionButton
            testId="twitch-automod-deny"
            disabled={pending}
            danger
            onClick={() =>
              runUiTask(
                decideTwitchAutoModMessage(api, {
                  channelSlug: channel,
                  messageId,
                  decision: 'deny',
                }),
              )
            }
          >
            Deny
          </ActionButton>
        </div>
      </div>
      <div key={messageId} style={{ minWidth: 0, maxHeight: 54, overflowY: 'scroll' }}>
        <Text style={{ fontSize: 13, lineHeight: 18, color: theme.text }}>
          {sanitizeDisplayText(`${displayName}: ${displayText}`)}
        </Text>
      </div>
      {message.state === 'pending' && message.error ? (
        <Text style={{ fontSize: 12, color: theme.dangerText }}>
          {truncateGraphemes(sanitizeDisplayText(message.error), 180)}
        </Text>
      ) : null}
    </div>
  )
})
