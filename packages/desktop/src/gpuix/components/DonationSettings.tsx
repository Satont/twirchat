import {
  DONATION_PROVIDERS,
  DONATION_PROVIDER_LABELS,
  isShareableDonationProvider,
  type DonationConnection,
  type DonationConnections,
  type DonationOAuthAvailability,
  type DonationProvider,
  type DonationSharing,
} from '@twirchat/shared/donations'
import { useEffect, useState } from 'react'

import { useBackend } from '../backend/context'
import { runUiTask } from '../hooks/run-ui-task'
import { useT } from '../i18n'
import { useTheme } from '../theme-context'
import { DonationBrandMark } from './DonationBrandMark'
import { SettingsFooter } from './settings/SettingsLayout'
import { ActionButton } from './ui/Form'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'

const statusLabels = {
  disconnected: 'Disconnected',
  authorizing: 'Waiting for authorization in your browser…',
  connecting: 'Connecting…',
  connected: 'Connected',
  error: 'Connection failed',
} satisfies Record<DonationConnection['status'], string>

interface DonationAvailabilitySnapshot {
  backend: ReturnType<typeof useBackend>
  value: DonationOAuthAvailability | null
}

function DonationProviderSettings({
  provider,
  connection,
  available,
  sharing,
}: {
  provider: DonationProvider
  connection: DonationConnection
  available: boolean | undefined
  sharing: DonationSharing | null
}) {
  const { api } = useBackend()
  const theme = useTheme()
  const { t } = useT()
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const status = connection.status
  const hasConnection = status !== 'disconnected'
  const pending = status === 'authorizing' || status === 'connecting'
  const canConnect = status === 'disconnected' || status === 'error'
  const showConnect = canConnect && available === true
  const availabilityLabel =
    canConnect && available !== true
      ? t(available === false ? 'settings.donations.notEnabled' : 'settings.donations.checking')
      : null
  const connectionColor = {
    disconnected: theme.text2,
    authorizing: theme.warningText,
    connecting: theme.warningText,
    connected: theme.successText,
    error: theme.dangerText,
  }[status]
  const statusColor = availabilityLabel ? theme.text2 : connectionColor
  const error =
    actionError || (connection.status === 'error' && available !== false ? connection.message : '')

  const shared = sharing && isShareableDonationProvider(provider) ? sharing[provider] : undefined

  async function changeSharing(enabled: boolean) {
    if (!isShareableDonationProvider(provider)) return
    setActionError('')
    try {
      await api.setDonationSharing({ provider, enabled })
    } catch {
      setActionError(t('settings.donations.shareFailed'))
    }
  }

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
              {availabilityLabel ?? statusLabels[status]}
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
      {hasConnection && shared !== undefined ? (
        <div
          tabIndex={0}
          testId={`donation-share-${provider}`}
          onKeyDown={(event) => {
            if (event.key === 'enter' || event.key === 'space') {
              event.preventDefault()
              runUiTask(changeSharing(!shared))
            }
          }}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flexShrink: 1 }}
          >
            <Text style={{ fontSize: 12, color: theme.text }}>{t('settings.donations.share')}</Text>
            <Text style={{ fontSize: 11, color: theme.text2 }}>
              {t('settings.donations.share.desc')}
            </Text>
          </div>
          <Switch
            checked={shared}
            testId={`donation-share-switch-${provider}`}
            onChange={(enabled) => runUiTask(changeSharing(enabled))}
          />
        </div>
      ) : null}
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
  const [sharing, setSharing] = useState<DonationSharing | null>(null)
  const [availability, setAvailability] = useState<DonationAvailabilitySnapshot>()
  const oauthAvailability = availability?.backend === backend ? availability.value : undefined
  const available: Record<DonationProvider, boolean | undefined> = {
    donationalerts: backend.api.donationAlertsOAuthAvailable,
    donatepay: true,
    memealerts: oauthAvailability === null ? true : oauthAvailability?.memealerts,
  }
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    let active = true
    let received = false
    let receivedSharing = false
    const unsubscribe = backend.events.on('donation_connections', (value) => {
      received = true
      setLoadError('')
      setConnections(value)
    })
    const unsubscribeSharing = backend.events.on('donation_sharing', (value) => {
      receivedSharing = true
      setSharing(value)
    })
    async function loadSharing() {
      try {
        const value = await backend.api.getDonationSharing()
        if (active && !receivedSharing) setSharing(value)
      } catch {
        if (active && !receivedSharing) setLoadError('Could not load donation sharing.')
      }
    }
    async function loadConnections() {
      try {
        const value = await backend.api.getDonationConnections()
        if (active && !received) setConnections(value)
      } catch {
        if (active && !received) setLoadError('Could not load donation connections.')
      }
    }
    async function loadAvailability() {
      let value: DonationOAuthAvailability | null
      try {
        value = await backend.api.getDonationOAuthAvailability()
      } catch {
        value = null
      }
      if (active) setAvailability({ backend, value })
    }
    runUiTask(loadConnections())
    runUiTask(loadSharing())
    runUiTask(loadAvailability())
    return () => {
      active = false
      unsubscribe()
      unsubscribeSharing()
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
              available={available[provider]}
              sharing={sharing}
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
