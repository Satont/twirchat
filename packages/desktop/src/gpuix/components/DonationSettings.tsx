import {
  DONATION_PROVIDERS,
  DONATION_PROVIDER_LABELS,
  type DonationConnection,
  type DonationConnections,
  type DonationProvider,
} from '@twirchat/shared/donations'
import { useEffect, useState } from 'react'

import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useTheme } from '../theme-context'
import { SettingsFooter } from './settings/SettingsLayout'
import { ActionButton } from './ui/Form'
import { Text } from './ui/Text'

const statusLabels = {
  disconnected: 'Disconnected',
  authorizing: 'Waiting for authorization in your browser…',
  connecting: 'Connecting…',
  connected: 'Connected',
  error: 'Connection failed',
} satisfies Record<DonationConnection['status'], string>

function DonationProviderSettings({
  provider,
  connection,
}: {
  provider: DonationProvider
  connection: DonationConnection
}) {
  const { api } = useBackend()
  const theme = useTheme()
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const status = connection.status
  const hasConnection = status !== 'disconnected'
  const pending = status === 'authorizing' || status === 'connecting'
  const showConnect = status === 'disconnected' || status === 'error'

  async function changeConnection(connect: boolean) {
    setBusy(true)
    setActionError('')
    try {
      if (!connect) await api.disconnectDonationProvider({ provider })
      else if (provider === 'donatepay') {
        const apiKey = (await api.readClipboard()).trim()
        if (!apiKey) {
          setActionError('Copy your DonatePay API key to the clipboard first.')
          return
        }
        await api.connectDonationProvider({ provider, apiKey })
      } else await api.connectDonationProvider({ provider })
    } catch {
      const action = connect ? 'connect to' : 'disconnect'
      setActionError(`Could not ${action} ${DONATION_PROVIDER_LABELS[provider]}.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        paddingTop: 12,
        borderTopWidth: 1,
        borderColor: theme.border,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>
        {DONATION_PROVIDER_LABELS[provider]}
      </Text>
      <Text
        testId={`donation-status-${provider}`}
        style={{ fontSize: 12, color: status === 'connected' ? theme.successText : theme.text2 }}
      >
        {statusLabels[status]}
      </Text>
      {provider === 'donatepay' && showConnect ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>
          Copy your API key from DonatePay. TwirChat saves it encrypted.
        </Text>
      ) : null}
      {actionError || connection.status === 'error' ? (
        <Text style={{ fontSize: 12, color: theme.dangerText }}>
          {actionError || (connection.status === 'error' ? connection.message : '')}
        </Text>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {showConnect ? (
          <ActionButton
            primary
            disabled={busy}
            testId={`donation-connect-${provider}`}
            onClick={() => runUiTask(changeConnection(true))}
          >
            {provider === 'donatepay'
              ? 'Connect with API key from clipboard'
              : 'Connect in browser'}
          </ActionButton>
        ) : null}
        {provider === 'donatepay' && showConnect ? (
          <ActionButton
            onClick={() => runUiTask(api.openExternalUrl({ url: 'https://donatepay.ru/page/api' }))}
          >
            Open DonatePay API page
          </ActionButton>
        ) : null}
        {hasConnection ? (
          <ActionButton
            disabled={busy}
            testId={`donation-disconnect-${provider}`}
            onClick={() => runUiTask(changeConnection(false))}
          >
            {pending ? 'Cancel' : 'Disconnect'}
          </ActionButton>
        ) : null}
      </div>
    </div>
  )
}

export function DonationSettings() {
  const backend = useBackend()
  const theme = useTheme()
  const [connections, setConnections] = useState<DonationConnections | null>(null)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    let active = true
    let received = false
    const unsubscribe = backend.events.on('donation_connections', (value) => {
      received = true
      setLoadError('')
      setConnections(value)
    })
    async function loadConnections() {
      try {
        const value = await backend.api.getDonationConnections()
        if (active && !received) setConnections(value)
      } catch {
        if (active && !received) setLoadError('Could not load donation connections.')
      }
    }
    runUiTask(loadConnections())
    return () => {
      active = false
      unsubscribe()
    }
  }, [backend])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Text style={{ fontSize: 12, color: theme.text2 }}>
        New donations appear as events in My channels while TwirChat is open.
      </Text>
      {connections ? (
        DONATION_PROVIDERS.map((provider) => (
          <DonationProviderSettings
            key={provider}
            provider={provider}
            connection={connections[provider]}
          />
        ))
      ) : !loadError ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>Loading connections…</Text>
      ) : null}
      <SettingsFooter
        sectionId="donations"
        error={loadError}
        note="Connect and disconnect apply immediately."
      />
    </div>
  )
}
