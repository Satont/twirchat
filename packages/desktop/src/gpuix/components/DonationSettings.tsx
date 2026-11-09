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
import { DonationBrandMark } from './DonationBrandMark'
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
  const statusColor = {
    disconnected: theme.text2,
    authorizing: theme.warningText,
    connecting: theme.warningText,
    connected: theme.successText,
    error: theme.dangerText,
  }[status]
  const error = actionError || (connection.status === 'error' ? connection.message : '')

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
        gap: 8,
        paddingTop: 14,
        paddingBottom: 14,
        borderTopWidth: 1,
        borderColor: theme.border,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            flexGrow: 1,
            flexBasis: 164,
            gap: 12,
            minWidth: 0,
          }}
        >
          <DonationBrandMark provider={provider} size={42} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <Text style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
              {DONATION_PROVIDER_LABELS[provider]}
            </Text>
            <Text style={{ fontSize: 11, color: theme.text2 }}>
              {provider === 'donatepay' ? 'API key' : 'Browser sign-in'}
            </Text>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingRight: 4,
              minWidth: 0,
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                flexShrink: 0,
                backgroundColor: statusColor,
              }}
            />
            <Text
              testId={`donation-status-${provider}`}
              style={{ fontSize: 12, color: statusColor, minWidth: 0 }}
            >
              {statusLabels[status]}
            </Text>
          </div>
          {showConnect ? (
            <ActionButton
              primary
              disabled={busy}
              testId={`donation-connect-${provider}`}
              onClick={() => runUiTask(changeConnection(true))}
            >
              {provider === 'donatepay' ? 'Connect with API key' : 'Connect in browser'}
            </ActionButton>
          ) : null}
          {provider === 'donatepay' && showConnect ? (
            <ActionButton
              onClick={() =>
                runUiTask(api.openExternalUrl({ url: 'https://donatepay.ru/page/api' }))
              }
            >
              Get API key
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
      {provider === 'donatepay' && showConnect ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>
          Copy your API key from DonatePay. TwirChat saves it encrypted.
        </Text>
      ) : null}
      {error ? <Text style={{ fontSize: 12, color: theme.dangerText }}>{error}</Text> : null}
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
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {DONATION_PROVIDERS.map((provider) => (
            <DonationProviderSettings
              key={provider}
              provider={provider}
              connection={connections[provider]}
            />
          ))}
        </div>
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
