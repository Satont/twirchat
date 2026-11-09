import { useEffect, useMemo, useRef, useState } from 'react'

import {
  exportImageUploaderSettings,
  importImageUploaderSettings,
  validateImageUploaderSettings,
  type ImageUploaderSettings as Settings,
} from '../../services/image-uploader'
import { useBackend } from '../backend/context'
import { useT } from '../i18n'
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
  const { t, language } = useT()
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
      return cause instanceof Error ? cause.message : t('imageUploaderSettings.review')
    }
    // Validation errors are translated: recompute them when the UI language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, t, language])

  useEffect(() => {
    loadImageUploaderSettings(api).catch(() => setError(t('imageUploaderSettings.loadFailed')))
    return () => connectController.current?.abort()
  }, [api, t])

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
        cause instanceof Error ? cause.message : t('imageUploaderSettings.updateFailed'),
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
        throw new Error(t('imageUploaderSettings.clipboardRead'))
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
        throw new Error(t('imageUploaderSettings.clipboardCopy'))
      })
      setNotice(t('imageUploaderSettings.copied'))
    })
  }

  const busy = operation !== null
  return (
    <div
      testId="image-uploader-settings"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <Text style={{ fontSize: 12, color: theme.text2 }}>
        {t('imageUploaderSettings.intro', { shortcut: PASTE_SHORTCUT })}
      </Text>
      {current ? (
        <>
          <FormField label={t('imageUploaderSettings.twir')}>
            <Text style={{ fontSize: 11, color: theme.text2 }}>
              {operation === 'connect'
                ? t('imageUploaderSettings.signInComplete')
                : twir
                  ? t('imageUploaderSettings.connected')
                  : t('imageUploaderSettings.signInHint')}
            </Text>
            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <ActionButton
                disabled={busy || confirmation !== null}
                testId="image-uploader-twir-connect"
                onClick={() => void connectTwir()}
              >
                {operation === 'connect'
                  ? t('imageUploaderSettings.waiting')
                  : twir
                    ? t('imageUploaderSettings.reconnect')
                    : t('imageUploaderSettings.signIn')}
              </ActionButton>
              {operation === 'connect' ? (
                <ActionButton
                  testId="image-uploader-twir-cancel"
                  onClick={() => connectController.current?.abort()}
                >
                  {t('imageUploaderSettings.cancelSignIn')}
                </ActionButton>
              ) : twir ? (
                <ActionButton
                  disabled={busy}
                  testId="image-uploader-twir-disconnect"
                  onClick={() => void disconnectTwir()}
                >
                  {operation === 'disconnect'
                    ? t('imageUploaderSettings.disconnecting')
                    : t('imageUploaderSettings.disconnect')}
                </ActionButton>
              ) : null}
            </div>
            <FormError>{twirError}</FormError>
          </FormField>
          <SettingsSwitch
            label={t('imageUploaderSettings.uploadFromClipboard')}
            testId="image-uploader-enable"
            checked={current.enabled}
            onChange={(enabled) => change('enabled', enabled)}
          />
          <SettingsSwitch
            label={t('imageUploaderSettings.askBefore')}
            testId="image-uploader-confirm"
            checked={current.confirm}
            onChange={(confirm) => change('confirm', confirm)}
          />
          {!twir ? (
            <>
              <FormField
                label={t('imageUploaderSettings.requestUrl')}
                hint={t('imageUploaderSettings.requestUrlHint')}
              >
                <FormInput
                  testId="image-uploader-request-url"
                  value={current.requestUrl}
                  placeholder="https://images.example.com/upload"
                  onChange={(value) => change('requestUrl', value)}
                />
              </FormField>
              <FormField
                label={t('imageUploaderSettings.formField')}
                hint={t('imageUploaderSettings.formFieldHint')}
              >
                <FormInput
                  testId="image-uploader-form-field"
                  value={current.formField}
                  placeholder="file"
                  onChange={(value) => change('formField', value)}
                />
              </FormField>
              <FormField
                label={t('imageUploaderSettings.extraHeaders')}
                hint={t('imageUploaderSettings.extraHeadersHint')}
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
                      ? t('imageUploaderSettings.hideHeaders')
                      : current.headers
                        ? t('imageUploaderSettings.showHeaders')
                        : t('imageUploaderSettings.addHeaders')}
                  </ActionButton>
                </div>
              </FormField>
              <FormField
                label={t('imageUploaderSettings.imageLink')}
                hint={t('imageUploaderSettings.imageLinkHint')}
              >
                <FormInput
                  testId="image-uploader-image-link"
                  value={current.imageLink}
                  placeholder="{data.url}"
                  onChange={(value) => change('imageLink', value)}
                />
              </FormField>
              <FormField
                label={t('imageUploaderSettings.deletionLink')}
                hint={t('imageUploaderSettings.deletionLinkHint')}
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
                  {operation === 'import'
                    ? t('imageUploaderSettings.readingClipboard')
                    : t('imageUploaderSettings.import')}
                </ActionButton>
                <ActionButton
                  disabled={busy || confirmation !== null}
                  testId="image-uploader-export"
                  onClick={() => setConfirmation({ kind: 'export' })}
                >
                  {operation === 'export'
                    ? t('imageUploaderSettings.copying')
                    : t('imageUploaderSettings.export')}
                </ActionButton>
              </>
            ) : null}
          </SettingsFooter>
          {!twir && confirmation ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text style={{ fontSize: 12, color: theme.text }}>
                {confirmation.kind === 'import'
                  ? t('imageUploaderSettings.importConfirm')
                  : t('imageUploaderSettings.exportWarning')}
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
                      setNotice(t('imageUploaderSettings.imported'))
                    }}
                  >
                    {t('imageUploaderSettings.replaceSettings')}
                  </ActionButton>
                ) : (
                  <ActionButton
                    primary
                    disabled={busy}
                    testId="image-uploader-copy-export"
                    onClick={() => void copyExport(current)}
                  >
                    {t('imageUploaderSettings.copyConfiguration')}
                  </ActionButton>
                )}
                <ActionButton
                  testId="image-uploader-cancel-clipboard"
                  onClick={() => setConfirmation(null)}
                >
                  {t('imageUploaderSettings.cancel')}
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
                  throw new Error(t('imageUploaderSettings.loadFailed'))
                })
              })
            }
          >
            {t('imageUploaderSettings.tryAgain')}
          </ActionButton>
        </div>
      ) : (
        <Text style={{ fontSize: 12, color: theme.text2 }}>
          {t('imageUploaderSettings.loading')}
        </Text>
      )}
      {current ? null : <FormError>{error}</FormError>}
    </div>
  )
}
