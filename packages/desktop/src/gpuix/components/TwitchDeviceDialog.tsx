import { useState } from 'react'

import { useBackend, useBackendEvent } from '../backend/context'
import type { DesktopEventMap } from '../backend/events'
import { runUiTask } from '../hooks/run-ui-task'
import { useT } from '../i18n'
import { useTheme } from '../theme-context'
import { ActionButton } from './ui/Form'
import { Modal } from './ui/Modal'
import { Text } from './ui/Text'

export function TwitchDeviceDialog() {
  const { api } = useBackend()
  const theme = useTheme()
  const { t } = useT()
  const [prompt, setPrompt] = useState<DesktopEventMap['twitch_device_code']>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  useBackendEvent('twitch_device_code', setPrompt)

  if (!prompt) return null
  const { url, userCode } = prompt
  const cancel = () => runUiTask(api.cancelTwitchAuth({ userCode }))
  const copy = () => runUiTask(api.copyText({ text: userCode }).then(() => setCopiedCode(userCode)))

  return (
    <Modal width={460} onClose={cancel} closeOnOutsideClick={false}>
      <div
        testId="twitch-device-sign-in"
        style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 20 }}
      >
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: 700 }}>
          {t('app.platforms.twitchDevice.title')}
        </Text>
        <Text style={{ color: theme.text2, fontSize: 13 }}>
          {t('app.platforms.twitchDevice.description')}
        </Text>
        <Text
          testId="twitch-device-code"
          style={{ color: theme.text, fontSize: 24, fontWeight: 700 }}
        >
          {userCode}
        </Text>
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <ActionButton
            testId="twitch-device-open"
            primary
            onClick={() => runUiTask(api.openExternalUrl({ url }))}
          >
            {t('app.platforms.twitchDevice.open')}
          </ActionButton>
          <ActionButton testId="twitch-device-copy" onClick={copy}>
            {copiedCode === userCode
              ? t('common.copied')
              : t('app.platforms.twitchDevice.copyCode')}
          </ActionButton>
          <ActionButton testId="twitch-device-cancel" onClick={cancel}>
            {t('common.cancel')}
          </ActionButton>
        </div>
      </div>
    </Modal>
  )
}
