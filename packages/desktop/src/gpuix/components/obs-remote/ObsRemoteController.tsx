import { useWindowSize } from '@gpuix/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createObsRemoteSnapshot,
  type ObsRemoteCommand,
  type ObsRemoteSnapshot,
} from '../../../services/obs-remote'
import { useBackend } from '../../backend/context'
import type {
  ObsRemoteConnection,
  ObsRemoteProfile,
  ObsRemoteProfileDraft,
} from '../../backend/obs-remote'
import { useT } from '../../i18n'
import { useStoreSelector } from '../../state/create-store'
import { useWindowScope } from '../../state/window-scope'
import { windowVisibilityStore } from '../../state/window-visibility'
import { useTheme } from '../../theme-context'
import { ActionButton, FormError, FormField, FormInput } from '../ui/Form'
import { Modal } from '../ui/Modal'
import { Text } from '../ui/Text'
import { Choice, Section, timecode } from './Controls'
import { Mixer } from './Mixer'
import { Preview } from './Preview'
import { Scenes } from './Scenes'

interface Confirmation {
  title: string
  description: string
  action: () => Promise<void>
}

export function ObsRemoteController({ active }: { active: boolean }) {
  const { api } = useBackend()
  const theme = useTheme()
  const { t } = useT()
  const size = useWindowSize()
  const scope = useWindowScope()
  const visible = useStoreSelector(
    windowVisibilityStore,
    (state) => active && state.windows.get(scope) !== 'hidden',
  )
  const [profiles, setProfiles] = useState<ObsRemoteProfile[]>([])
  const [selected, setSelected] = useState('')
  const [connection, setConnection] = useState<ObsRemoteConnection | null>(null)
  const connectionRef = useRef<ObsRemoteConnection | null>(null)
  const [snapshot, setSnapshot] = useState<ObsRemoteSnapshot>(createObsRemoteSnapshot)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editor, setEditor] = useState<ObsRemoteProfileDraft | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [duration, setDuration] = useState<string | null>(null)
  const generation = useRef(0)
  const mounted = useRef(true)
  const operation = useRef(false)
  const report = useCallback((cause: unknown) => {
    if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
  }, [])

  async function task(action: () => Promise<void>) {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      report(cause)
    } finally {
      operation.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const cleanup = useCallback(() => {
    mounted.current = false
    generation.current++
    const current = connectionRef.current
    connectionRef.current = null
    if (current) current.dispose().catch(report)
  }, [report])

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    api.obsRemote
      .list()
      .then((items) => {
        if (!cancelled) {
          setProfiles(items)
          setSelected(items[0]?.id ?? '')
        }
        return undefined
      })
      .catch(report)
    return () => {
      cancelled = true
      cleanup()
    }
  }, [api, cleanup, report])

  useEffect(() => {
    if (connection && snapshot.connected) connection.setMetering(visible).catch(report)
  }, [connection, snapshot.connected, visible, report])

  if (!active) return null

  const narrow = size.width < 900
  const panelWidth = Math.max(260, size.width - 48 - (narrow ? 0 : 300))
  const frameWidth = snapshot.studioMode
    ? Math.floor((panelWidth - 12) / 2)
    : Math.min(panelWidth, Math.round((Math.max(180, Math.min(345, size.height - 535)) * 16) / 9))
  const profile = profiles.find((item) => item.id === selected)

  async function disconnect() {
    generation.current++
    const previous = connectionRef.current
    connectionRef.current = null
    setConnection(null)
    setSnapshot(createObsRemoteSnapshot())
    if (previous) await previous.dispose()
  }

  async function connect() {
    await disconnect()
    const token = generation.current
    const next = await api.obsRemote.createSession(selected, (state) => {
      if (mounted.current && token === generation.current) setSnapshot(state)
    })
    if (!mounted.current || token !== generation.current) {
      await next.dispose()
      return
    }
    connectionRef.current = next
    setConnection(next)
    await next.connect()
  }

  function run(command: ObsRemoteCommand) {
    const current = connectionRef.current
    if (current) task(() => current.run(command)).catch(report)
  }

  function confirmCommand(title: string, description: string, command: ObsRemoteCommand) {
    const current = connectionRef.current
    if (current) setConfirmation({ title, description, action: () => current.run(command) })
  }

  async function selectProfile(id: string) {
    await disconnect()
    setSelected(id)
  }

  function chooseProfile(id: string) {
    if (id === selected) return
    if (connection)
      setConfirmation({
        title: t('obsRemote.confirm.switchConnectionTitle'),
        description: t('obsRemote.confirm.switchConnectionBody'),
        action: () => selectProfile(id),
      })
    else task(() => selectProfile(id)).catch(report)
  }

  const disabled = busy || !snapshot.connected
  const replayActive = snapshot.replayBuffer === 'active'
  const replayUnavailable = snapshot.replayBuffer === 'unavailable'
  return (
    <div
      testId="obs-remote-controller"
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        backgroundColor: theme.bg,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: 16,
          borderBottomWidth: 1,
          borderColor: theme.border,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Text style={{ color: theme.text, fontSize: 20, fontWeight: 700 }}>OBS Remote</Text>
            <Text
              style={{ color: snapshot.connected ? theme.successText : theme.text2, fontSize: 11 }}
            >
              {`${busy ? t('obsRemote.status.working') : snapshot.connected ? t('obsRemote.status.connected', { version: snapshot.version }) : t('obsRemote.status.disconnected')}${profile ? ` · ${profile.name}` : ''}`}
            </Text>
          </div>
          <ActionButton
            testId="obs-add-profile"
            disabled={busy}
            onClick={() => {
              setShowPassword(false)
              setEditor({ name: '', url: 'ws://localhost:4455', password: '' })
            }}
          >
            {t('obsRemote.action.addConnection')}
          </ActionButton>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {profiles.map((item) => (
            <ActionButton
              key={item.id}
              testId={`obs-select-profile-${item.name}`}
              disabled={busy}
              primary={selected === item.id}
              onClick={() => chooseProfile(item.id)}
            >
              {item.name}
            </ActionButton>
          ))}
          <ActionButton
            testId="obs-connect"
            primary
            disabled={busy || !profile}
            onClick={() => {
              task(snapshot.connected ? disconnect : connect).catch(report)
            }}
          >
            {snapshot.connected ? t('common.disconnect') : t('common.connect')}
          </ActionButton>
          {profile ? (
            <>
              <ActionButton
                testId="obs-edit-profile"
                disabled={busy}
                onClick={() => {
                  setShowPassword(false)
                  setEditor({ id: profile.id, name: profile.name, url: profile.url })
                }}
              >
                {t('common.edit')}
              </ActionButton>
              <ActionButton
                testId="obs-remove-profile"
                disabled={busy}
                danger
                onClick={() =>
                  setConfirmation({
                    title: t('obsRemote.confirm.removeTitle', { name: profile.name }),
                    description: t('obsRemote.confirm.removeBody'),
                    action: async () => {
                      await disconnect()
                      const items = await api.obsRemote.remove(profile.id)
                      setProfiles(items)
                      setSelected(items[0]?.id ?? '')
                    },
                  })
                }
              >
                {t('common.remove')}
              </ActionButton>
            </>
          ) : null}
        </div>
        <FormError>{error || snapshot.error}</FormError>
      </div>
      <div
        testId="obs-controller-scroll"
        style={{
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: 0,
          minHeight: 0,
          overflowY: 'scroll',
          scrollbarColor: theme.scrollbar,
          scrollbarWidth: 5,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {!profiles.length ? (
          <div style={{ padding: 24, backgroundColor: theme.surface, borderRadius: 8, gap: 8 }}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: 600 }}>
              {t('obsRemote.empty.title')}
            </Text>
            <Text style={{ color: theme.text2, fontSize: 12 }}>{t('obsRemote.empty.body')}</Text>
          </div>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <ActionButton
            testId="obs-stream"
            disabled={disabled}
            danger={snapshot.stream.active}
            primary={!snapshot.stream.active}
            onClick={() =>
              confirmCommand(
                snapshot.stream.active
                  ? t('obsRemote.confirm.stopStreamTitle')
                  : t('obsRemote.confirm.startStreamTitle'),
                snapshot.stream.active
                  ? t('obsRemote.confirm.stopStreamBody')
                  : t('obsRemote.confirm.startStreamBody'),
                { kind: 'stream', active: !snapshot.stream.active },
              )
            }
          >
            {snapshot.stream.active
              ? t('obsRemote.stream.stopLive', { time: timecode(snapshot.stream.duration) })
              : t('obsRemote.stream.goLive')}
          </ActionButton>
          <ActionButton
            testId="obs-record"
            disabled={disabled}
            danger={snapshot.record.active}
            onClick={() =>
              confirmCommand(
                snapshot.record.active
                  ? t('obsRemote.confirm.stopRecordTitle')
                  : t('obsRemote.confirm.startRecordTitle'),
                snapshot.record.active
                  ? t('obsRemote.confirm.stopRecordBody')
                  : t('obsRemote.confirm.startRecordBody'),
                { kind: 'record', action: snapshot.record.active ? 'stop' : 'start' },
              )
            }
          >
            {snapshot.record.active
              ? t('obsRemote.record.stop', { time: timecode(snapshot.record.duration) })
              : t('obsRemote.record.start')}
          </ActionButton>
          <ActionButton
            testId="obs-record-pause"
            disabled={disabled || !snapshot.record.active}
            onClick={() =>
              run({ kind: 'record', action: snapshot.record.paused ? 'resume' : 'pause' })
            }
          >
            {snapshot.record.paused ? t('obsRemote.record.resume') : t('obsRemote.record.pause')}
          </ActionButton>
          <ActionButton
            disabled={disabled || !snapshot.virtualCameraAvailable}
            primary={snapshot.virtualCamera}
            onClick={() => run({ kind: 'virtual-camera', active: !snapshot.virtualCamera })}
          >
            {snapshot.connected && !snapshot.virtualCameraAvailable
              ? t('obsRemote.virtualCamera.unavailable')
              : t('obsRemote.virtualCamera.label')}
          </ActionButton>
          <ActionButton
            testId="obs-replay-buffer"
            disabled={disabled || replayUnavailable}
            primary={replayActive}
            onClick={() => run({ kind: 'replay-buffer', active: !replayActive })}
          >
            {snapshot.connected && replayUnavailable
              ? t('obsRemote.replay.unavailable')
              : t('obsRemote.replay.label')}
          </ActionButton>
          <ActionButton
            testId="obs-save-replay"
            disabled={disabled || !replayActive}
            onClick={() => run({ kind: 'save-replay' })}
          >
            {t('obsRemote.replay.save')}
          </ActionButton>
          <ActionButton
            testId="obs-studio-mode"
            disabled={disabled}
            primary={snapshot.studioMode}
            onClick={() => run({ kind: 'studio-mode', enabled: !snapshot.studioMode })}
          >
            {t('obsRemote.studioMode')}
          </ActionButton>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Choice
            label={t('obsRemote.choice.profile')}
            value={snapshot.profile}
            values={snapshot.profiles}
            disabled={disabled}
            onChange={(name) =>
              confirmCommand(
                t('obsRemote.confirm.switchProfileTitle'),
                t('obsRemote.confirm.switchProfileBody', { name }),
                { kind: 'profile', name },
              )
            }
          />
          <Choice
            label={t('obsRemote.choice.collection')}
            value={snapshot.collection}
            values={snapshot.collections}
            disabled={disabled}
            onChange={(name) =>
              confirmCommand(
                t('obsRemote.confirm.switchCollectionTitle'),
                t('obsRemote.confirm.switchCollectionBody', { name }),
                {
                  kind: 'collection',
                  name,
                },
              )
            }
          />
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: narrow ? 'column' : 'row',
            alignItems: 'flex-start',
            gap: 20,
          }}
        >
          <div style={{ width: panelWidth, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {connection && snapshot.connected ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    justifyContent: 'center',
                    gap: 12,
                  }}
                >
                  {snapshot.studioMode ? (
                    <Preview
                      key={`preview:${snapshot.previewScene}`}
                      connection={connection}
                      source={snapshot.previewScene}
                      active={visible}
                      width={frameWidth}
                      label={t('obsRemote.preview.previewLabel')}
                      tone="preview"
                      testId="obs-preview-preview"
                    />
                  ) : null}
                  <Preview
                    key={`program:${snapshot.programScene}`}
                    connection={connection}
                    source={snapshot.programScene}
                    active={visible}
                    width={frameWidth}
                    label={t('obsRemote.preview.programLabel')}
                    tone="program"
                    testId="obs-program-preview"
                  />
                </div>
                {snapshot.studioMode ? (
                  <Section title={t('obsRemote.transition.title')}>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Text style={{ color: theme.text2, fontSize: 11 }}>
                        {t('obsRemote.transition.duration')}
                      </Text>
                      <div style={{ width: 64 }}>
                        <FormInput
                          testId="obs-transition-duration"
                          value={duration ?? String(snapshot.transitionDuration || 300)}
                          onChange={setDuration}
                        />
                      </div>
                      {snapshot.transitions.map((transition) => (
                        <ActionButton
                          testId={`obs-transition-${transition.name}`}
                          key={transition.name}
                          disabled={disabled}
                          primary={transition.name === snapshot.transition}
                          onClick={() => {
                            const milliseconds = Number(
                              duration ?? (snapshot.transitionDuration || 300),
                            )
                            if (
                              !Number.isFinite(milliseconds) ||
                              milliseconds < 50 ||
                              milliseconds > 20000
                            ) {
                              setError(t('obsRemote.transition.invalid'))
                              return
                            }
                            run({
                              kind: 'transition',
                              name: transition.name,
                              duration: milliseconds,
                            })
                          }}
                        >
                          {t('obsRemote.transition.toProgram', { name: transition.name })}
                        </ActionButton>
                      ))}
                    </div>
                  </Section>
                ) : null}
              </>
            ) : (
              <div
                style={{
                  width: panelWidth,
                  height: Math.min(300, (panelWidth * 9) / 16),
                  backgroundColor: theme.surface,
                  borderRadius: 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <Text style={{ color: theme.text, fontSize: 17 }}>
                  {t('obsRemote.programPreview.title')}
                </Text>
                <Text style={{ color: theme.text2, fontSize: 12 }}>
                  {t('obsRemote.programPreview.body')}
                </Text>
              </div>
            )}
            {snapshot.stats ? (
              <Text style={{ fontSize: 11, color: theme.text2 }}>
                {t('obsRemote.stats.line', {
                  fps: snapshot.stats.activeFps.toFixed(1),
                  cpu: snapshot.stats.cpuUsage.toFixed(1),
                  skipped: snapshot.stats.renderSkippedFrames,
                  free: (snapshot.stats.availableDiskSpace / 1024).toFixed(1),
                })}
              </Text>
            ) : null}
            {snapshot.stream.active ? (
              <Text style={{ fontSize: 11, color: theme.text2 }}>
                {t('obsRemote.stream.stats', {
                  bitrate: Math.round(snapshot.stream.bitrate),
                  dropped: snapshot.stream.frames
                    ? ((100 * snapshot.stream.skippedFrames) / snapshot.stream.frames).toFixed(1)
                    : '0.0',
                  congestion: (100 * snapshot.stream.congestion).toFixed(0),
                })}
              </Text>
            ) : null}
          </div>
          <div style={{ width: narrow ? '100%' : 280, minWidth: 0 }}>
            {connection && snapshot.connected ? (
              <Scenes
                snapshot={snapshot}
                connection={connection}
                active={visible}
                run={run}
                disabled={disabled}
              />
            ) : (
              <Section title={t('obsRemote.scenes.title')}>
                <Text style={{ color: theme.text2, fontSize: 12 }}>
                  {t('obsRemote.scenes.connectHint')}
                </Text>
              </Section>
            )}
          </div>
        </div>
        <Mixer
          key={selected}
          inputs={snapshot.inputs}
          panicActive={snapshot.panicActive}
          run={run}
          disabled={disabled}
        />
      </div>
      {editor ? (
        <Modal
          width={460}
          onClose={() => {
            if (!busy) setEditor(null)
          }}
        >
          <div
            style={{
              padding: 20,
              gap: 14,
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 1,
              minHeight: 0,
              overflowY: 'scroll',
              scrollbarColor: theme.scrollbar,
              scrollbarWidth: 4,
            }}
          >
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: 600 }}>
              {editor.id ? t('obsRemote.editor.editTitle') : t('obsRemote.editor.addTitle')}
            </Text>
            <FormField label={t('obsRemote.editor.name')}>
              <FormInput
                testId="obs-profile-name"
                value={editor.name}
                onChange={(name) => setEditor({ ...editor, name })}
                placeholder={t('obsRemote.editor.namePlaceholder')}
              />
            </FormField>
            <FormField label={t('obsRemote.editor.address')}>
              <FormInput
                testId="obs-profile-url"
                value={editor.url}
                onChange={(url) => setEditor({ ...editor, url })}
                placeholder="ws://localhost:4455"
              />
            </FormField>
            <ActionButton
              testId="obs-paste-link"
              disabled={busy}
              onClick={() => {
                task(async () => {
                  const parsed = api.obsRemote.parseAddress(await api.readClipboard())
                  setEditor((current) => (current ? { ...current, ...parsed } : null))
                  setShowPassword(false)
                }).catch(report)
              }}
            >
              {t('obsRemote.editor.pasteLink')}
            </ActionButton>
            <FormField
              label={t('obsRemote.editor.password')}
              hint={
                editor.id
                  ? t('obsRemote.editor.passwordHintEdit')
                  : t('obsRemote.editor.passwordHintAdd')
              }
            >
              <Text style={{ color: theme.text2, fontSize: 12 }}>
                {editor.password === undefined
                  ? t('obsRemote.editor.passwordUnchanged')
                  : editor.password
                    ? t('obsRemote.editor.passwordSet')
                    : t('obsRemote.editor.passwordNone')}
              </Text>
              <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <ActionButton
                  testId="obs-paste-password"
                  disabled={busy}
                  onClick={() => {
                    task(async () => {
                      const password = await api.readClipboard()
                      setEditor((current) => (current ? { ...current, password } : null))
                      setShowPassword(false)
                    }).catch(report)
                  }}
                >
                  {t('obsRemote.editor.pastePassword')}
                </ActionButton>
                <ActionButton
                  testId="obs-type-password"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword
                    ? t('obsRemote.editor.hidePassword')
                    : t('obsRemote.editor.showPassword')}
                </ActionButton>
              </div>
              {showPassword ? (
                <FormInput
                  testId="obs-profile-password"
                  value={editor.password ?? ''}
                  onChange={(password) => setEditor({ ...editor, password })}
                  placeholder={t('obsRemote.editor.passwordPlaceholder')}
                />
              ) : null}
            </FormField>
            {editor.id ? (
              <ActionButton onClick={() => setEditor({ ...editor, password: '' })}>
                {t('obsRemote.editor.removePassword')}
              </ActionButton>
            ) : null}
            <FormError>{error}</FormError>
            <div
              style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 6 }}
            >
              <ActionButton disabled={busy} onClick={() => setEditor(null)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton
                testId="obs-save-profile"
                primary
                disabled={busy || !editor.name.trim() || !editor.url.trim()}
                onClick={() => {
                  const draft = editor
                  const save = async () => {
                    if (draft.id === selected && connection) await disconnect()
                    const items = await api.obsRemote.save(draft)
                    setProfiles(items)
                    if (!connection || draft.id === selected)
                      setSelected(draft.id ?? items.at(-1)?.id ?? '')
                    setShowPassword(false)
                    setEditor(null)
                  }
                  if (draft.id && connection)
                    setConfirmation({
                      title: t('obsRemote.confirm.saveChangesTitle'),
                      description: t('obsRemote.confirm.saveChangesBody'),
                      action: save,
                    })
                  else task(save).catch(report)
                }}
              >
                {t('obsRemote.editor.save')}
              </ActionButton>
            </div>
          </div>
        </Modal>
      ) : null}
      {confirmation ? (
        <Modal
          width={420}
          closeOnOutsideClick={false}
          onClose={() => {
            if (!busy) setConfirmation(null)
          }}
        >
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: 600 }}>
              {confirmation.title}
            </Text>
            <Text style={{ color: theme.text2, fontSize: 12 }}>{confirmation.description}</Text>
            <FormError>{error}</FormError>
            <div
              style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 6 }}
            >
              <ActionButton disabled={busy} onClick={() => setConfirmation(null)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton
                testId="obs-confirm"
                primary
                disabled={busy}
                onClick={() => {
                  task(async () => {
                    await confirmation.action()
                    setConfirmation(null)
                  }).catch(report)
                }}
              >
                {t('obsRemote.confirm.confirm')}
              </ActionButton>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
