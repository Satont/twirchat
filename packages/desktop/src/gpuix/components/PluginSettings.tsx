import { useEffect, useRef, useState } from 'react'

import type { PluginInfo } from '../../plugins/api'
import { sanitizeDisplayText } from '../../views/shared/utils/display-text'
import { useBackend } from '../backend/context'
import { useTheme } from '../theme-context'
import { SettingsFooter } from './settings/SettingsLayout'
import { ActionButton, FormError, FormField, FormInput } from './ui/Form'
import { Text } from './ui/Text'

const EMPTY_PLUGINS: readonly PluginInfo[] = []
const STATUS_LABELS: Record<PluginInfo['status'], string> = {
  disabled: 'Disabled',
  starting: 'Starting…',
  running: 'Enabled',
  incompatible: 'Incompatible',
  error: 'Failed',
}

export function PluginSettings() {
  const { events, plugins } = useBackend()
  const theme = useTheme()
  const [list, setList] = useState(() => plugins?.list() ?? EMPTY_PLUGINS)
  const [path, setPath] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null)
  const busy = useRef(false)
  useEffect(() => {
    const unsubscribe = events.on('plugins_changed', setList)
    const refresh = setTimeout(() => setList(plugins?.list() ?? EMPTY_PLUGINS), 0)
    return () => {
      clearTimeout(refresh)
      unsubscribe()
    }
  }, [events, plugins])

  function run(key: string, action: () => Promise<void>) {
    if (busy.current) return
    busy.current = true
    setError('')
    setNotice(null)
    setPending(key)
    void action()
      .catch((cause) =>
        setError(sanitizeDisplayText(cause instanceof Error ? cause.message : String(cause))),
      )
      .finally(() => {
        busy.current = false
        setPending(null)
      })
  }

  if (!plugins) return <Text style={{ color: theme.text2 }}>Plugin support is unavailable.</Text>

  const manifest = path.trim()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <Text style={{ fontSize: 12, color: theme.text2 }}>
        New plugins start disabled. Enable plugins from sources you trust. Enabled plugins can read
        chat, use your connected accounts to send messages, and access files as your user. Plugins
        installed from a URL update automatically.
      </Text>
      {list.length === 0 ? (
        <Text style={{ fontSize: 12, color: theme.text2 }}>No plugins installed.</Text>
      ) : (
        list.map((plugin) => (
          <div
            key={plugin.id}
            testId={`plugin-row-${plugin.id}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              paddingTop: 10,
              borderTopWidth: 1,
              borderColor: theme.hairline,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>
              {sanitizeDisplayText(plugin.name)}
            </Text>
            <Text
              testId={`plugin-status-${plugin.id}`}
              style={{ fontSize: 12, color: theme.text2 }}
            >
              {plugin.version
                ? `${plugin.version} · ${STATUS_LABELS[plugin.status]}`
                : STATUS_LABELS[plugin.status]}
            </Text>
            {plugin.sourceUrl ? (
              <Text
                testId={`plugin-source-${plugin.id}`}
                style={{
                  fontSize: 12,
                  color: theme.text2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {sanitizeDisplayText(plugin.sourceUrl.split(/[?#]/u, 1)[0] ?? '')}
              </Text>
            ) : null}
            <FormError>{plugin.error && sanitizeDisplayText(plugin.error)}</FormError>
            <FormError>
              {plugin.updateError && `Update failed. ${sanitizeDisplayText(plugin.updateError)}`}
            </FormError>
            {notice?.id === plugin.id ? (
              <Text style={{ fontSize: 12, color: theme.text2 }}>{notice.text}</Text>
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {plugin.enabled && plugin.status === 'error' ? (
                <ActionButton
                  disabled={pending !== null}
                  onClick={() => run(plugin.id, () => plugins.setEnabled(plugin.id, true))}
                >
                  Retry
                </ActionButton>
              ) : null}
              {plugin.status !== 'incompatible' || plugin.enabled ? (
                <ActionButton
                  testId={`plugin-toggle-${plugin.id}`}
                  disabled={pending !== null}
                  onClick={() =>
                    run(plugin.id, () => plugins.setEnabled(plugin.id, !plugin.enabled))
                  }
                >
                  {plugin.enabled ? 'Disable' : 'Enable'}
                </ActionButton>
              ) : null}
              {plugin.sourceUrl ? (
                <ActionButton
                  testId={`plugin-check-update-${plugin.id}`}
                  disabled={pending !== null}
                  onClick={() =>
                    run(`check:${plugin.id}`, async () => {
                      const updated = await plugins.checkForUpdate(plugin.id).catch(() => null)
                      if (updated === null) return
                      const name = sanitizeDisplayText(plugin.name)
                      setNotice({
                        id: plugin.id,
                        text: updated ? `Updated ${name}.` : `No newer version of ${name}.`,
                      })
                    })
                  }
                >
                  {pending === `check:${plugin.id}` ? 'Checking…' : 'Check for update'}
                </ActionButton>
              ) : null}
              <ActionButton
                testId={`plugin-remove-${plugin.id}`}
                danger
                disabled={pending !== null}
                onClick={() => run(plugin.id, () => plugins.remove(plugin.id))}
              >
                Remove
              </ActionButton>
            </div>
          </div>
        ))
      )}
      <FormField
        label="Install a plugin"
        hint="Enter a local manifest path or an HTTPS URL. GitHub file links also work."
      >
        <FormInput
          testId="plugin-manifest-path"
          value={path}
          onChange={setPath}
          placeholder="https://example.com/plugin/manifest.json"
        />
      </FormField>
      <div style={{ display: 'flex', flexDirection: 'row' }}>
        <ActionButton
          testId="plugin-install"
          primary
          disabled={!manifest || pending !== null}
          onClick={() =>
            run('install', async () => {
              await plugins.install(manifest)
              setPath('')
            })
          }
        >
          {pending === 'install' ? 'Installing…' : 'Install plugin'}
        </ActionButton>
      </div>
      <SettingsFooter
        sectionId="plugins"
        error={error}
        errorTestId="plugin-settings-error"
        note="Plugin actions apply immediately."
      />
    </div>
  )
}
