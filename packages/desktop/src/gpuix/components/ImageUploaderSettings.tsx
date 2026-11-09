import { useEffect, useMemo, useRef, useState } from 'react'

import {
  exportImageUploaderSettings,
  importImageUploaderSettings,
  validateImageUploaderSettings,
  type ImageUploaderSettings as Settings,
} from '../../services/image-uploader'
import { useBackend } from '../backend/context'
import { useStore } from '../state/create-store'
import {
  applyImageUploaderSettings,
  imageUploaderSettingsStore,
  loadImageUploaderSettings,
} from '../state/image-uploader'
import { useTheme } from '../theme-context'
import { SettingsFooter } from './settings/SettingsLayout'
import { ActionButton, FormError, FormField, FormInput } from './ui/Form'
import { Switch } from './ui/Switch'
import { Text } from './ui/Text'

type Operation = 'load' | 'save' | 'import' | 'export' | 'connect' | 'disconnect'
type ClipboardConfirmation = { kind: 'import'; settings: Settings } | { kind: 'export' }

const PASTE_SHORTCUT = process.platform === 'darwin' ? 'Cmd+V' : 'Ctrl+V'

function SettingsSwitch({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  testId: string
}) {
  const theme = useTheme()
  return (
    <div
      testId={testId}
      tabIndex={0}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onKeyDown={(event) => {
        if (event.key === 'enter' || event.key === 'space') {
          event.preventDefault()
          onChange(!checked)
        }
      }}
      style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}
    >
      <Text style={{ fontSize: 12, color: theme.text, flexGrow: 1, minWidth: 0 }}>{label}</Text>
      <Switch checked={checked} onChange={onChange} />
    </div>
  )
}

export function ImageUploaderSettings() {
  const { api } = useBackend()
  const theme = useTheme()
  const saved = useStore(imageUploaderSettingsStore)
  const [manualDraft, setManualDraft] = useState<Settings | null>(null)
  const [twirDraft, setTwirDraft] = useState<Settings | null>(null)
  const [confirmation, setConfirmation] = useState<ClipboardConfirmation | null>(null)
  const [headersVisible, setHeadersVisible] = useState(false)
  const [operation, setOperation] = useState<Operation | null>(null)
  const operationRef = useRef<Operation | null>(null)
  const connectController = useRef<AbortController | null>(null)
  const [error, setError] = useState('')
  const [twirError, setTwirError] = useState('')
  const [notice, setNotice] = useState('')
  const twir = saved?.provider === 'twir'
  const draft = twir ? twirDraft : manualDraft
  const setDraft = twir ? setTwirDraft : setManualDraft
  const draftRef = useRef(draft)
  draftRef.current = draft
  const current = draft ?? saved
  const dirty = useMemo(
    () => draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved],
  )
  const validation = useMemo(() => {
    if (!draft) return ''
    try {
      validateImageUploaderSettings(draft)
      return ''
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'Review the uploader settings.'
    }
  }, [draft])

  useEffect(() => {
    loadImageUploaderSettings(api).catch(() => setError('Could not load image uploader settings.'))
    return () => connectController.current?.abort()
  }, [api])

  function change<K extends keyof Settings>(key: K, value: Settings[K]): void {
    setDraft((previous) => {
      const baseline = previous ?? saved
      return baseline ? { ...baseline, [key]: value } : null
    })
    setError('')
    setNotice('')
  }

  async function run(action: Operation, task: () => Promise<void>): Promise<void> {
    if (operationRef.current) return
    operationRef.current = action
    setOperation(action)
    const setActionError = action === 'connect' || action === 'disconnect' ? setTwirError : setError
    setActionError('')
    setNotice('')
    try {
      await task()
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : 'Image uploader settings could not be updated.',
      )
    } finally {
      operationRef.current = null
      setOperation(null)
    }
  }

  async function connectTwir(): Promise<void> {
    await run('connect', async () => {
      const controller = new AbortController()
      connectController.current = controller
      try {
        applyImageUploaderSettings(
          await api.connectTwirImageUploader({ signal: controller.signal }),
        )
      } catch (cause) {
        if (!controller.signal.aborted) throw cause
      } finally {
        connectController.current = null
      }
    })
  }

  async function disconnectTwir(): Promise<void> {
    await run('disconnect', async () => {
      applyImageUploaderSettings(await api.disconnectTwirImageUploader())
      setTwirDraft(null)
    })
  }

  async function save(settings: Settings): Promise<boolean> {
    let saved = false
    await run('save', async () => {
      const persisted = await api.saveImageUploaderSettings(settings)
      applyImageUploaderSettings(persisted)
      setDraft((previous) => (previous === settings ? null : previous))
      saved = draftRef.current === settings
    })
    return saved
  }

  async function readImport(settings: Settings): Promise<void> {
    await run('import', async () => {
      const clipboard = await api.readClipboard().catch(() => {
        throw new Error('Could not read the clipboard. Copy the uploader configuration and retry.')
      })
      setConfirmation({
        kind: 'import',
        settings: importImageUploaderSettings(clipboard, settings),
      })
    })
  }

  async function copyExport(settings: Settings): Promise<void> {
    setConfirmation(null)
    await run('export', async () => {
      const exported = exportImageUploaderSettings(settings)
      await api.copyText({ text: exported }).catch(() => {
        throw new Error('Could not copy the configuration to the clipboard.')
      })
      setNotice('Uploader configuration copied to the clipboard.')
    })
  }

  const busy = operation !== null
  return (
    <div
      testId="image-uploader-settings"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <Text style={{ fontSize: 12, color: theme.text2 }}>
        {`Paste an image in the chat input with ${PASTE_SHORTCUT}. TwirChat uploads it to your chosen server and inserts the link into your draft.`}
      </Text>
      {current ? (
        <>
          <FormField label="Twir">
            <Text style={{ fontSize: 11, color: theme.text2 }}>
              {operation === 'connect'
                ? 'Complete sign-in in your browser.'
                : twir
                  ? 'Twir is connected for image uploads.'
                  : 'Sign in to upload through Twir without setting up an upload URL or headers.'}
            </Text>
            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <ActionButton
                disabled={busy || confirmation !== null}
                testId="image-uploader-twir-connect"
                onClick={() => void connectTwir()}
              >
                {operation === 'connect'
                  ? 'Waiting for Twir…'
                  : twir
                    ? 'Reconnect'
                    : 'Sign in with Twir'}
              </ActionButton>
              {operation === 'connect' ? (
                <ActionButton
                  testId="image-uploader-twir-cancel"
                  onClick={() => connectController.current?.abort()}
                >
                  Cancel sign-in
                </ActionButton>
              ) : twir ? (
                <ActionButton
                  disabled={busy}
                  testId="image-uploader-twir-disconnect"
                  onClick={() => void disconnectTwir()}
                >
                  {operation === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
                </ActionButton>
              ) : null}
            </div>
            <FormError>{twirError}</FormError>
          </FormField>
          <SettingsSwitch
            label="Upload images from the clipboard"
            testId="image-uploader-enable"
            checked={current.enabled}
            onChange={(enabled) => change('enabled', enabled)}
          />
          <SettingsSwitch
            label="Ask before uploading"
            testId="image-uploader-confirm"
            checked={current.confirm}
            onChange={(confirm) => change('confirm', confirm)}
          />
          {!twir ? (
            <>
              <FormField label="Request URL" hint="The endpoint that accepts a multipart POST.">
                <FormInput
                  testId="image-uploader-request-url"
                  value={current.requestUrl}
                  placeholder="https://images.example.com/upload"
                  onChange={(value) => change('requestUrl', value)}
                />
              </FormField>
              <FormField
                label="Form field"
                hint="The multipart field that contains the image file."
              >
                <FormInput
                  testId="image-uploader-form-field"
                  value={current.formField}
                  placeholder="file"
                  onChange={(value) => change('formField', value)}
                />
              </FormField>
              <FormField
                label="Extra headers"
                hint="Use one header per line or separate headers with semicolons. For example, enter Authorization: Bearer TOKEN."
              >
                {headersVisible ? (
                  <FormInput
                    multiline
                    testId="image-uploader-headers"
                    value={current.headers}
                    onChange={(value) => change('headers', value)}
                  />
                ) : null}
                <div style={{ alignSelf: 'flex-start' }}>
                  <ActionButton
                    testId="image-uploader-show-headers"
                    onClick={() => setHeadersVisible(!headersVisible)}
                  >
                    {headersVisible
                      ? 'Hide headers'
                      : current.headers
                        ? 'Show headers'
                        : 'Add headers'}
                  </ActionButton>
                </div>
              </FormField>
              <FormField
                label="Image link"
                hint="Leave blank if the response is a plain URL. For JSON, use a template such as {data.images.0.url}."
              >
                <FormInput
                  testId="image-uploader-image-link"
                  value={current.imageLink}
                  placeholder="{data.url}"
                  onChange={(value) => change('imageLink', value)}
                />
              </FormField>
              <FormField
                label="Deletion link"
                hint="Optional. Use the same template syntax to keep a private deletion link."
              >
                <FormInput
                  testId="image-uploader-deletion-link"
                  value={current.deletionLink}
                  placeholder="{data.deleteUrl}"
                  onChange={(value) => change('deletionLink', value)}
                />
              </FormField>
            </>
          ) : null}
          <SettingsFooter
            sectionId="image-uploader"
            dirty={dirty}
            saving={operation === 'save'}
            error={error || validation}
            errorTestId="image-uploader-error"
            note={notice}
            disabled={busy || !draft || Boolean(validation)}
            saveTestId="image-uploader-save"
            onSave={() => save(current)}
            onDiscard={() => {
              setDraft(null)
              setConfirmation(null)
              setHeadersVisible(false)
              setNotice('')
              setError('')
            }}
          >
            {!twir ? (
              <>
                <ActionButton
                  disabled={busy || confirmation !== null}
                  testId="image-uploader-import"
                  onClick={() => void readImport(current)}
                >
                  {operation === 'import' ? 'Reading clipboard…' : 'Import from clipboard'}
                </ActionButton>
                <ActionButton
                  disabled={busy || confirmation !== null}
                  testId="image-uploader-export"
                  onClick={() => setConfirmation({ kind: 'export' })}
                >
                  {operation === 'export' ? 'Copying…' : 'Export to clipboard'}
                </ActionButton>
              </>
            ) : null}
          </SettingsFooter>
          {!twir && confirmation ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text style={{ fontSize: 12, color: theme.text }}>
                {confirmation.kind === 'import'
                  ? 'Replace the settings in this form with the clipboard configuration? Save the form to apply it.'
                  : 'The copied configuration includes any credentials in the request URL and headers.'}
              </Text>
              <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {confirmation.kind === 'import' ? (
                  <ActionButton
                    primary
                    disabled={busy}
                    testId="image-uploader-apply-import"
                    onClick={() => {
                      setDraft({ ...confirmation.settings, confirm: current.confirm })
                      setConfirmation(null)
                      setHeadersVisible(false)
                      setNotice('Configuration imported. Save to apply it.')
                    }}
                  >
                    Replace settings
                  </ActionButton>
                ) : (
                  <ActionButton
                    primary
                    disabled={busy}
                    testId="image-uploader-copy-export"
                    onClick={() => void copyExport(current)}
                  >
                    Copy configuration
                  </ActionButton>
                )}
                <ActionButton
                  testId="image-uploader-cancel-clipboard"
                  onClick={() => setConfirmation(null)}
                >
                  Cancel
                </ActionButton>
              </div>
            </div>
          ) : null}
        </>
      ) : error ? (
        <div style={{ alignSelf: 'flex-start' }}>
          <ActionButton
            disabled={busy}
            onClick={() =>
              void run('load', async () => {
                await loadImageUploaderSettings(api).catch(() => {
                  throw new Error('Could not load image uploader settings.')
                })
              })
            }
          >
            Try again
          </ActionButton>
        </div>
      ) : (
        <Text style={{ fontSize: 12, color: theme.text2 }}>Loading uploader settings…</Text>
      )}
      {current ? null : <FormError>{error}</FormError>}
    </div>
  )
}
