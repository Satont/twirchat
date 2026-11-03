import type { NormalizedChatMessage } from '@twirchat/shared/types'
import { useEffect, useEffectEvent } from 'react'

import { translatedMessage } from '../../services/translation'
import { useBackend } from '../backend/context'
import { chatMessageKey } from '../chat-tools'
import { runUiTask } from '../hooks/run-ui-task'
import { useStoreSelector } from '../state/create-store'
import { messageTranslationsStore, requestMessageTranslation } from '../state/translation'
import { useTheme } from '../theme-context'
import { MessageText } from './MessageText'
import { Text } from './ui/Text'

export function MessageTranslation({
  message,
  channelId,
  request = 0,
  fontSize = 12,
}: {
  message: NormalizedChatMessage
  channelId?: string
  request?: number
  fontSize?: number
}) {
  const backend = useBackend()
  const theme = useTheme()
  const key = chatMessageKey(message)
  const translation = useStoreSelector(messageTranslationsStore, (values) => values.get(key))
  const translate = useEffectEvent(() =>
    runUiTask(requestMessageTranslation(backend, message, { channelId, force: true })),
  )
  useEffect(() => {
    if (request) translate()
  }, [request, key])
  if (!translation) return null
  return (
    <div
      testId={`message-translation-${message.id}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        marginTop: 4,
        paddingTop: 4,
        borderTopWidth: 1,
        borderColor: theme.hairline,
        minWidth: 0,
      }}
    >
      {translation.status === 'loading' ? (
        <Text style={{ fontSize: 11, color: theme.text2 }}>Translating…</Text>
      ) : translation.status === 'error' ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Text style={{ fontSize: 11, color: theme.dangerText }}>{translation.error}</Text>
          <div
            onClick={() =>
              void requestMessageTranslation(backend, message, {
                channelId,
                targetLanguage: translation.targetLanguage,
                force: true,
              })
            }
            style={{ cursor: 'pointer' }}
          >
            <Text style={{ fontSize: 11, color: theme.link }}>Retry translation</Text>
          </div>
        </div>
      ) : translation.result ? (
        <>
          <Text
            style={{ fontSize: 10, color: theme.text2 }}
          >{`Translated ${translation.result.sourceLanguage ?? 'auto'} → ${translation.result.targetLanguage}`}</Text>
          <MessageText
            message={translatedMessage(message, translation.result.text)}
            fontSize={fontSize}
          />
        </>
      ) : null}
    </div>
  )
}
