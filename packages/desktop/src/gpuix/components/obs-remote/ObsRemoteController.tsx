import { useGpuixRequired, useWindowSize } from '@gpuix/react'
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
import { nativeWindow } from '../../native-window'
import { settingsStore } from '../../state/app'
import { useStoreSelector } from '../../state/create-store'
import { useWindowScope } from '../../state/window-scope'
import { windowVisibilityStore } from '../../state/window-visibility'
import { useTheme, ThemeContext, FontContext, resolveTheme, resolveFont } from '../../theme-context'
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

export function ObsRemoteController() {
  const theme = useStoreSelector(settingsStore, resolveTheme)
  const font = useStoreSelector(settingsStore, resolveFont)
  return (
    <ThemeContext.Provider value={theme}>
      <FontContext.Provider value={font}>
        <ControllerContent />
      </FontContext.Provider>
    </ThemeContext.Provider>
  )
}

function ControllerContent() {
  const { api } = useBackend()
  const theme = useTheme()
  const renderer = useGpuixRequired()
  const size = useWindowSize()
  const scope = useWindowScope()
  const visible = useStoreSelector(
    windowVisibilityStore,
    (state) => state.windows.get(scope) !== 'hidden',
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
  const [fullscreen, setFullscreen] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [duration, setDuration] = useState<string | null>(null)
  const generation = useRef(0)
  const mounted = useRef(true)
  const operation = useRef(false)
  const narrow = size.width < 900
  const panelWidth = Math.max(260, size.width - 48 - (narrow ? 0 : 300))
  const frameWidth = snapshot.studioMode
    ? Math.max(140, Math.floor((panelWidth - 12) / 2))
    : Math.min(panelWidth, Math.round((Math.max(180, Math.min(345, size.height - 535)) * 16) / 9))
  const profile = profiles.find((item) => item.id === selected)

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
        title: 'Switch OBS connection?',
        description: 'This disconnects the controller. OBS keeps streaming and recording.',
        action: () => selectProfile(id),
      })
    else task(() => selectProfile(id)).catch(report)
  }

  const disabled = busy || !snapshot.connected
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
              {`${busy ? 'Working…' : snapshot.connected ? `Connected · OBS ${snapshot.version}` : 'Disconnected'}${profile ? ` · ${profile.name}` : ''}`}
            </Text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <ActionButton
              testId="obs-add-profile"
              disabled={busy}
              onClick={() => {
                setShowPassword(false)
                setEditor({ name: '', url: 'ws://localhost:4455', password: '' })
              }}
            >
              Add connection
            </ActionButton>
            <ActionButton
              disabled={busy}
              onClick={() => {
                task(async () => {
                  await nativeWindow(renderer).setWindowBounds({
                    mode: fullscreen ? 'windowed' : 'fullscreen',
                  })
                  setFullscreen(!fullscreen)
                }).catch(report)
              }}
            >
              {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            </ActionButton>
          </div>
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
            {snapshot.connected ? 'Disconnect' : 'Connect'}
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
                Edit
              </ActionButton>
              <ActionButton
                testId="obs-remove-profile"
                disabled={busy}
                danger
                onClick={() =>
                  setConfirmation({
                    title: `Remove ${profile.name}?`,
                    description: 'The saved address and password will be removed.',
                    action: async () => {
                      await disconnect()
                      const items = await api.obsRemote.remove(profile.id)
                      setProfiles(items)
                      setSelected(items[0]?.id ?? '')
                    },
                  })
                }
              >
                Remove
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
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: 600 }}>Connect to OBS</Text>
            <Text style={{ color: theme.text2, fontSize: 12 }}>
              Enable WebSocket Server in OBS under Tools → WebSocket Server Settings, then add a
              connection.
            </Text>
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
                snapshot.stream.active ? 'Stop streaming?' : 'Start streaming?',
                snapshot.stream.active
                  ? 'The live broadcast will end.'
                  : 'OBS will go live with the current program scene.',
                { kind: 'stream', active: !snapshot.stream.active },
              )
            }
          >
            {snapshot.stream.active
              ? `Stop live · ${timecode(snapshot.stream.duration)}`
              : 'Go live'}
          </ActionButton>
          <ActionButton
            testId="obs-record"
            disabled={disabled}
            danger={snapshot.record.active}
            onClick={() =>
              confirmCommand(
                snapshot.record.active ? 'Stop recording?' : 'Start recording?',
                snapshot.record.active
                  ? 'OBS will finalize the current recording.'
                  : 'OBS will record to its configured output folder.',
                { kind: 'record', action: snapshot.record.active ? 'stop' : 'start' },
              )
            }
          >
            {snapshot.record.active
              ? `Stop recording · ${timecode(snapshot.record.duration)}`
              : 'Record'}
          </ActionButton>
          <ActionButton
            testId="obs-record-pause"
            disabled={disabled || !snapshot.record.active}
            onClick={() =>
              run({ kind: 'record', action: snapshot.record.paused ? 'resume' : 'pause' })
            }
          >
            {snapshot.record.paused ? 'Resume' : 'Pause'}
          </ActionButton>
          <ActionButton
            disabled={disabled || !snapshot.virtualCameraAvailable}
            primary={snapshot.virtualCamera}
            onClick={() => run({ kind: 'virtual-camera', active: !snapshot.virtualCamera })}
          >
            {snapshot.connected && !snapshot.virtualCameraAvailable
              ? 'Virtual camera unavailable'
              : 'Virtual camera'}
          </ActionButton>
          <ActionButton
            testId="obs-replay-buffer"
            disabled={disabled}
            primary={snapshot.replayBuffer}
            onClick={() => run({ kind: 'replay-buffer', active: !snapshot.replayBuffer })}
          >
            Replay buffer
          </ActionButton>
          <ActionButton
            testId="obs-save-replay"
            disabled={disabled || !snapshot.replayBuffer}
            onClick={() => run({ kind: 'save-replay' })}
          >
            Save replay
          </ActionButton>
          <ActionButton
            testId="obs-studio-mode"
            disabled={disabled}
            primary={snapshot.studioMode}
            onClick={() => run({ kind: 'studio-mode', enabled: !snapshot.studioMode })}
          >
            Studio mode
          </ActionButton>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Choice
            label="Profile"
            value={snapshot.profile}
            values={snapshot.profiles}
            disabled={disabled}
            onChange={(name) =>
              confirmCommand(
                'Switch OBS profile?',
                `OBS will load the output settings from ${name}.`,
                { kind: 'profile', name },
              )
            }
          />
          <Choice
            label="Collection"
            value={snapshot.collection}
            values={snapshot.collections}
            disabled={disabled}
            onChange={(name) =>
              confirmCommand('Switch scene collection?', `OBS will load the scenes from ${name}.`, {
                kind: 'collection',
                name,
              })
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
                      label="PREVIEW"
                      testId="obs-preview-preview"
                    />
                  ) : null}
                  <Preview
                    key={`program:${snapshot.programScene}`}
                    connection={connection}
                    source={snapshot.programScene}
                    active={visible}
                    width={frameWidth}
                    label="PROGRAM"
                    testId="obs-program-preview"
                  />
                </div>
                {snapshot.studioMode ? (
                  <Section title="Transition">
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Text style={{ color: theme.text2, fontSize: 11 }}>Duration (ms)</Text>
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
                              setError('Transition duration must be between 50 and 20000 ms.')
                              return
                            }
                            run({
                              kind: 'transition',
                              name: transition.name,
                              duration: milliseconds,
                            })
                          }}
                        >
                          {`${transition.name} → Program`}
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
                <Text style={{ color: theme.text, fontSize: 17 }}>Program preview</Text>
                <Text style={{ color: theme.text2, fontSize: 12 }}>
                  Connect to OBS to see your production.
                </Text>
              </div>
            )}
            {snapshot.stats ? (
              <Text style={{ fontSize: 11, color: theme.text2 }}>
                {`${snapshot.stats.activeFps.toFixed(1)} FPS · CPU ${snapshot.stats.cpuUsage.toFixed(1)}% · ${snapshot.stats.renderSkippedFrames} skipped frames · ${(snapshot.stats.availableDiskSpace / 1024).toFixed(1)} GB free`}
              </Text>
            ) : null}
            {snapshot.stream.active ? (
              <Text style={{ fontSize: 11, color: theme.text2 }}>
                {`${Math.round(snapshot.stream.bitrate)} kb/s · ${snapshot.stream.frames ? ((100 * snapshot.stream.skippedFrames) / snapshot.stream.frames).toFixed(1) : '0.0'}% dropped · ${(100 * snapshot.stream.congestion).toFixed(0)}% congestion`}
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
              <Section title="Scenes">
                <Text style={{ color: theme.text2, fontSize: 12 }}>
                  Scenes and sources appear after connecting.
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
          <div style={{ padding: 20, gap: 14, display: 'flex', flexDirection: 'column' }}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: 600 }}>
              {editor.id ? 'Edit connection' : 'Add connection'}
            </Text>
            <FormField label="Name">
              <FormInput
                testId="obs-profile-name"
                value={editor.name}
                onChange={(name) => setEditor({ ...editor, name })}
                placeholder="Streaming PC"
              />
            </FormField>
            <FormField label="WebSocket address">
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
              Paste OBS connection link
            </ActionButton>
            <FormField
              label="Password"
              hint={
                editor.id
                  ? 'Leave untouched to keep the saved password. Clear to remove it.'
                  : 'Use the password from OBS WebSocket Server Settings.'
              }
            >
              <Text style={{ color: theme.text2, fontSize: 12 }}>
                {editor.password === undefined
                  ? 'Saved password unchanged'
                  : editor.password
                    ? 'Password set'
                    : 'No password'}
              </Text>
              <div style={{ display: 'flex', flexDirection: 'row', gap: 6 }}>
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
                  Paste password
                </ActionButton>
                <ActionButton
                  testId="obs-type-password"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? 'Hide password' : 'Type password (visible)'}
                </ActionButton>
              </div>
              {showPassword ? (
                <FormInput
                  testId="obs-profile-password"
                  value={editor.password ?? ''}
                  onChange={(password) => setEditor({ ...editor, password })}
                  placeholder="WebSocket password"
                />
              ) : null}
            </FormField>
            {editor.id ? (
              <ActionButton onClick={() => setEditor({ ...editor, password: '' })}>
                Remove saved password
              </ActionButton>
            ) : null}
            <FormError>{error}</FormError>
            <div
              style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 6 }}
            >
              <ActionButton disabled={busy} onClick={() => setEditor(null)}>
                Cancel
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
                      title: 'Save connection changes?',
                      description:
                        'The controller will disconnect. OBS keeps streaming and recording.',
                      action: save,
                    })
                  else task(save).catch(report)
                }}
              >
                Save connection
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
                Cancel
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
                Confirm
              </ActionButton>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
