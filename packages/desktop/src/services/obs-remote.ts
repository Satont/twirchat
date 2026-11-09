import { EventSubscription, OBSWebSocket, OBSWebSocketError } from 'obs-websocket-js/json'
import type { OBSRequestTypes, OBSResponseTypes } from 'obs-websocket-js/json'
import { z } from 'zod'

import { t } from '../gpuix/i18n'

export interface ObsSceneItem {
  id: number
  scene: string
  name: string
  enabled: boolean
  kind: string
  children: ObsSceneItem[]
}

export interface ObsAudioInput {
  name: string
  muted: boolean
  volumeDb: number
  monitoring: string
  active: boolean
  global: boolean
  levels: number[]
}

export interface ObsOutputStatus {
  active: boolean
  paused: boolean
  duration: number
  bytes: number
  frames: number
  skippedFrames: number
  congestion: number
  bitrate: number
}

export interface ObsStats {
  cpuUsage: number
  memoryUsage: number
  availableDiskSpace: number
  activeFps: number
  averageFrameRenderTime: number
  renderSkippedFrames: number
  renderTotalFrames: number
  outputSkippedFrames: number
  outputTotalFrames: number
}

export interface ObsRemoteSnapshot {
  connected: boolean
  error: string | null
  version: string
  studioMode: boolean
  scenes: { name: string; items: ObsSceneItem[] }[]
  programScene: string
  previewScene: string
  transitions: { name: string; kind: string }[]
  transition: string
  transitionDuration: number
  transitionFixed: boolean
  stream: ObsOutputStatus
  record: ObsOutputStatus
  virtualCamera: boolean
  virtualCameraAvailable: boolean
  replayBuffer: 'unavailable' | 'stopped' | 'active'
  profiles: string[]
  profile: string
  collections: string[]
  collection: string
  inputs: ObsAudioInput[]
  stats: ObsStats | null
  panicActive: boolean
}

export type ObsRemoteCommand =
  | { kind: 'program' | 'preview'; scene: string }
  | { kind: 'studio-mode'; enabled: boolean }
  | { kind: 'transition'; name?: string; duration?: number }
  | { kind: 'scene-item'; scene: string; id: number; enabled: boolean }
  | { kind: 'rename-scene'; scene: string; name: string }
  | { kind: 'switch-source'; scene: string; id: number }
  | { kind: 'stream' | 'virtual-camera' | 'replay-buffer'; active: boolean }
  | { kind: 'record'; action: 'start' | 'stop' | 'pause' | 'resume' }
  | { kind: 'save-replay' | 'panic' | 'undo-panic' }
  | { kind: 'profile' | 'collection'; name: string }
  | { kind: 'mute'; input: string; muted: boolean }
  | { kind: 'volume'; input: string; db: number }
  | { kind: 'monitoring'; input: string; mode: string }

const sceneSchema = z.object({ sceneName: z.string() })
const itemSchema = z.object({
  sceneItemId: z.number().int(),
  sourceName: z.string(),
  sceneItemEnabled: z.boolean(),
  inputKind: z.string().nullable(),
  isGroup: z.boolean().nullish(),
  sourceType: z.string(),
})
const inputSchema = z.object({ inputName: z.string() })
const transitionSchema = z.object({ transitionName: z.string(), transitionKind: z.string() })
const meterSchema = z.array(
  z.object({
    inputName: z.string(),
    inputLevelsMul: z.array(z.array(z.number())),
  }),
)
const specialInputsSchema = z.record(z.string(), z.string().nullable())

function idleOutput(): ObsOutputStatus {
  return {
    active: false,
    paused: false,
    duration: 0,
    bytes: 0,
    frames: 0,
    skippedFrames: 0,
    congestion: 0,
    bitrate: 0,
  }
}

export function createObsRemoteSnapshot(): ObsRemoteSnapshot {
  return {
    connected: false,
    error: null,
    version: '',
    studioMode: false,
    scenes: [],
    programScene: '',
    previewScene: '',
    transitions: [],
    transition: '',
    transitionDuration: 300,
    transitionFixed: false,
    stream: idleOutput(),
    record: idleOutput(),
    virtualCamera: false,
    virtualCameraAvailable: false,
    replayBuffer: 'unavailable',
    profiles: [],
    profile: '',
    collections: [],
    collection: '',
    inputs: [],
    stats: null,
    panicActive: false,
  }
}

export function obsActiveSources(items: ObsSceneItem[]): Set<string> {
  const names = new Set<string>()
  const visit = (children: ObsSceneItem[]) => {
    for (const item of children) {
      if (!item.enabled) continue
      names.add(item.name)
      visit(item.children)
    }
  }
  visit(items)
  return names
}

export class ObsRemoteSession {
  private readonly obs = new OBSWebSocket()
  private readonly cancellation = new AbortController()
  private snapshot = createObsRemoteSnapshot()
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private refreshTask: Promise<void> | undefined
  private dirty = true
  private lastMeterAt = 0
  private lastStatusAt = 0
  private inputRevision = 0
  private readonly panicMutes = new Map<string, boolean>()
  private groups = new Set<string>()
  private commandTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly url: string,
    private readonly password: string,
    private readonly publish: (snapshot: ObsRemoteSnapshot) => void,
  ) {
    this.obs.on('ConnectionClosed', () => {
      this.cancellation.abort()
      this.stopTimer()
      this.update({
        connected: false,
        error: this.disposed ? null : t('notices.obs.connectionClosed'),
      })
    })
    this.obs.on('ConnectionError', (error) => this.update({ error: error.message }))
    this.obs.on('InputVolumeMeters', ({ inputs }) => {
      const now = Date.now()
      if (now - this.lastMeterAt < 100) return
      this.lastMeterAt = now
      const result = meterSchema.safeParse(inputs)
      if (!result.success) return
      const levels = new Map(
        result.data.map((input) => [
          input.inputName,
          input.inputLevelsMul.map((channel) => channel[1] ?? channel[0] ?? 0),
        ]),
      )
      this.update({
        inputs: this.snapshot.inputs.map((input) => ({
          ...input,
          levels: levels.get(input.name) ?? [],
        })),
      })
    })
    const invalidate = () => {
      this.dirty = true
    }
    this.obs.on('SceneListChanged', invalidate)
    this.obs.on('SceneNameChanged', invalidate)
    this.obs.on('CurrentProgramSceneChanged', ({ sceneName }) => this.setProgramScene(sceneName))
    this.obs.on('CurrentPreviewSceneChanged', ({ sceneName }) => {
      if (sceneName === this.snapshot.previewScene) return
      this.inputRevision++
      this.update({ previewScene: sceneName })
    })
    this.obs.on('StudioModeStateChanged', invalidate)
    this.obs.on('SceneItemCreated', invalidate)
    this.obs.on('SceneItemRemoved', invalidate)
    this.obs.on('SceneItemEnableStateChanged', invalidate)
    this.obs.on('SceneItemListReindexed', invalidate)
    this.obs.on('InputCreated', invalidate)
    this.obs.on('InputRemoved', ({ inputName }) => {
      this.panicMutes.delete(inputName)
      invalidate()
    })
    this.obs.on('InputNameChanged', ({ oldInputName, inputName }) => {
      const previousMute = this.panicMutes.get(oldInputName)
      this.panicMutes.delete(oldInputName)
      if (previousMute !== undefined) this.panicMutes.set(inputName, previousMute)
      invalidate()
    })
    this.obs.on('InputMuteStateChanged', (event) => {
      this.updateInput(event.inputName, { muted: event.inputMuted })
    })
    this.obs.on('InputVolumeChanged', (event) => {
      this.updateInput(event.inputName, { volumeDb: event.inputVolumeDb })
    })
    this.obs.on('InputAudioMonitorTypeChanged', (event) => {
      this.updateInput(event.inputName, { monitoring: event.monitorType })
    })
    this.obs.on('CurrentSceneTransitionChanged', invalidate)
    this.obs.on('CurrentSceneTransitionDurationChanged', invalidate)
    this.obs.on('CurrentProfileChanged', invalidate)
    this.obs.on('ProfileListChanged', invalidate)
    this.obs.on('CurrentSceneCollectionChanged', () => {
      this.panicMutes.clear()
      invalidate()
    })
    this.obs.on('SceneCollectionListChanged', invalidate)
  }

  private update(patch: Partial<ObsRemoteSnapshot>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...patch }
    this.publish(this.snapshot)
  }

  private updateInput(name: string, patch: Partial<ObsAudioInput>): void {
    this.inputRevision++
    this.update({
      inputs: this.snapshot.inputs.map((input) =>
        input.name === name ? { ...input, ...patch } : input,
      ),
    })
  }

  private setProgramScene(programScene: string): void {
    if (programScene === this.snapshot.programScene) return
    this.inputRevision++
    const scene = this.snapshot.scenes.find(({ name }) => name === programScene)
    if (!scene) this.dirty = true
    const active = obsActiveSources(scene?.items ?? [])
    this.update({
      programScene,
      inputs: this.snapshot.inputs.map((input) => ({
        ...input,
        active: input.global || active.has(input.name),
      })),
    })
  }

  private async bounded<T>(operation: Promise<T>, closing = false): Promise<T> {
    let cancel: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          if (!closing) {
            cancel = () => reject(new Error(t('notices.obs.sessionClosed')))
            if (this.cancellation.signal.aborted) cancel()
            else this.cancellation.signal.addEventListener('abort', cancel, { once: true })
          }
          timer = setTimeout(() => {
            reject(new Error(t('notices.obs.requestTimedOut')))
            this.obs.disconnect().catch(() => {})
          }, 10_000)
        }),
      ])
    } finally {
      clearTimeout(timer)
      if (cancel) this.cancellation.signal.removeEventListener('abort', cancel)
    }
  }

  private async call<K extends keyof OBSRequestTypes>(
    name: K,
    data?: OBSRequestTypes[K],
  ): Promise<OBSResponseTypes[K]> {
    if (this.disposed) throw new Error(t('notices.obs.sessionClosed'))
    return this.bounded(this.obs.call(name, data))
  }

  async connect(): Promise<void> {
    if (this.disposed) throw new Error(t('notices.obs.sessionClosed'))
    try {
      await this.bounded(
        this.obs.connect(this.url, this.password, {
          rpcVersion: 1,
          eventSubscriptions: EventSubscription.All,
        }),
      )
      if (this.disposed) {
        await this.obs.disconnect()
        return
      }
      const version = await this.call('GetVersion')
      this.snapshot = {
        ...this.snapshot,
        connected: true,
        version: version.obsVersion,
        error: null,
      }
      await this.refresh()
      this.schedule()
    } catch (error) {
      this.update({
        connected: false,
        error: error instanceof Error ? error.message : t('notices.obs.connectionFailed'),
      })
      await this.obs.disconnect()
      throw error
    }
  }

  private stopTimer(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private schedule(): void {
    this.stopTimer()
    if (this.disposed || !this.snapshot.connected) return
    this.timer = setTimeout(() => {
      this.refresh()
        .catch((error: unknown) => {
          this.update({
            error: error instanceof Error ? error.message : t('notices.obs.refreshFailed'),
          })
        })
        .finally(() => this.schedule())
    }, 1000)
  }

  private refresh(): Promise<void> {
    if (this.refreshTask) return this.refreshTask
    this.refreshTask = this.readSnapshot().finally(() => {
      this.refreshTask = undefined
    })
    return this.refreshTask
  }

  private async readSceneTrees(
    names: string[],
  ): Promise<{ name: string; items: ObsSceneItem[] }[]> {
    const lists = new Map<string, z.infer<typeof itemSchema>[]>()
    const groups = new Set<string>()
    const queued = new Set(names)
    const pending = names.map((name) => ({ name, group: false }))
    let itemCount = 0
    while (pending.length) {
      const batch = pending.splice(0, 8)
      await Promise.all(
        batch.map(async ({ name, group }) => {
          const result = await this.call(group ? 'GetGroupSceneItemList' : 'GetSceneItemList', {
            sceneName: name,
          })
          if (group) groups.add(name)
          const items = z.array(itemSchema).max(2048).parse(result.sceneItems)
          itemCount += items.length
          if (itemCount > 8192) throw new Error(t('notices.obs.sourceLimit'))
          lists.set(name, items)
          for (const item of items) {
            if (
              (item.isGroup || item.sourceType === 'OBS_SOURCE_TYPE_SCENE') &&
              !queued.has(item.sourceName)
            ) {
              if (queued.size >= 512) throw new Error(t('notices.obs.sceneLimit'))
              queued.add(item.sourceName)
              pending.push({ name: item.sourceName, group: item.isGroup ?? false })
            }
          }
        }),
      )
    }
    let expanded = 0
    const materialize = (name: string, ancestors: Set<string>): ObsSceneItem[] => {
      if (ancestors.has(name) || ancestors.size >= 16) return []
      const next = new Set(ancestors).add(name)
      return (lists.get(name) ?? []).map((item) => {
        expanded++
        if (expanded > 32768) throw new Error(t('notices.obs.nestedLimit'))
        return {
          id: item.sceneItemId,
          scene: name,
          name: item.sourceName,
          enabled: item.sceneItemEnabled,
          kind: item.inputKind ?? item.sourceType,
          children: materialize(item.sourceName, next),
        }
      })
    }
    this.groups = groups
    return names.map((name) => ({ name, items: materialize(name, new Set()) }))
  }

  private async readStructure(): Promise<Partial<ObsRemoteSnapshot>> {
    const [
      sceneList,
      studio,
      transitionList,
      transition,
      profiles,
      collections,
      inputList,
      specials,
    ] = await Promise.all([
      this.call('GetSceneList'),
      this.call('GetStudioModeEnabled'),
      this.call('GetSceneTransitionList'),
      this.call('GetCurrentSceneTransition'),
      this.call('GetProfileList'),
      this.call('GetSceneCollectionList'),
      this.call('GetInputList'),
      this.call('GetSpecialInputs'),
    ])
    const scenes = await this.readSceneTrees(
      z
        .array(sceneSchema)
        .max(512)
        .parse(sceneList.scenes)
        .map((scene) => scene.sceneName),
    )
    const active = obsActiveSources(
      scenes.find((scene) => scene.name === sceneList.currentProgramSceneName)?.items ?? [],
    )
    const globals = new Set(
      Object.values(specialInputsSchema.parse(specials)).filter(
        (name): name is string => name !== null && name !== '',
      ),
    )
    for (const name of globals) active.add(name)
    const inputs: ObsAudioInput[] = []
    const inputNames = new Set(
      z
        .array(inputSchema)
        .max(2048)
        .parse(inputList.inputs)
        .map((input) => input.inputName),
    )
    for (const name of globals) inputNames.add(name)
    const pendingInputs = [...inputNames]
    while (pendingInputs.length) {
      await Promise.all(
        pendingInputs.splice(0, 8).map(async (inputName) => {
          try {
            const volume = await this.call('GetInputVolume', { inputName: inputName })
            const [mute, monitor] = await Promise.all([
              this.call('GetInputMute', { inputName: inputName }),
              this.call('GetInputAudioMonitorType', { inputName: inputName }),
            ])
            inputs.push({
              name: inputName,
              muted: mute.inputMuted,
              volumeDb: volume.inputVolumeDb,
              monitoring: monitor.monitorType,
              active: active.has(inputName),
              global: globals.has(inputName),
              levels:
                this.snapshot.inputs.find((previous) => previous.name === inputName)?.levels ?? [],
            })
          } catch (error) {
            // Inputs without audio reject the audio-specific requests.
            if (!(error instanceof OBSWebSocketError) || error.code !== 604) throw error
          }
        }),
      )
    }
    return {
      scenes,
      studioMode: studio.studioModeEnabled,
      programScene: sceneList.currentProgramSceneName ?? '',
      previewScene: sceneList.currentPreviewSceneName ?? '',
      transitions: z
        .array(transitionSchema)
        .parse(transitionList.transitions)
        .map((item) => ({ name: item.transitionName, kind: item.transitionKind })),
      transition: transitionList.currentSceneTransitionName ?? '',
      transitionDuration: transition.transitionDuration ?? 0,
      transitionFixed: transition.transitionFixed,
      profiles: profiles.profiles,
      profile: profiles.currentProfileName,
      collections: collections.sceneCollections,
      collection: collections.currentSceneCollectionName,
      inputs: inputs.toSorted((left, right) => left.name.localeCompare(right.name)),
      panicActive: this.panicMutes.size > 0,
    }
  }

  private async readReplayBufferStatus(): Promise<ObsRemoteSnapshot['replayBuffer']> {
    try {
      const replay = await this.call('GetReplayBufferStatus')
      return replay.outputActive ? 'active' : 'stopped'
    } catch (error) {
      if (error instanceof OBSWebSocketError && error.code === 604) return 'unavailable'
      throw error
    }
  }

  private async readSnapshot(): Promise<void> {
    const revision = this.inputRevision
    const structure = this.dirty
    this.dirty = false
    try {
      const patch = structure ? await this.readStructure() : {}
      const [stream, record, camera, replayBuffer, stats] = await Promise.all([
        this.call('GetStreamStatus'),
        this.call('GetRecordStatus'),
        this.call('GetVirtualCamStatus').catch((error: unknown) => {
          if (error instanceof OBSWebSocketError && error.code === 604) return null
          throw error
        }),
        this.readReplayBufferStatus(),
        this.call('GetStats'),
      ])
      const now = Date.now()
      const elapsed = this.lastStatusAt ? now - this.lastStatusAt : 0
      const bitrate = (bytes: number, previous: number) =>
        elapsed > 0 ? Math.max(0, ((bytes - previous) * 8) / elapsed) : 0
      this.lastStatusAt = now
      if (!this.snapshot.connected) return
      if (structure && (this.dirty || revision !== this.inputRevision)) {
        this.dirty = true
        return
      }
      this.update({
        ...patch,
        error: null,
        stats,
        virtualCamera: camera?.outputActive ?? false,
        virtualCameraAvailable: camera !== null,
        replayBuffer,
        stream: {
          active: stream.outputActive,
          paused: false,
          duration: stream.outputDuration,
          bytes: stream.outputBytes,
          frames: stream.outputTotalFrames,
          skippedFrames: stream.outputSkippedFrames,
          congestion: stream.outputCongestion,
          bitrate: bitrate(stream.outputBytes, this.snapshot.stream.bytes),
        },
        record: {
          active: record.outputActive,
          paused: record.outputPaused,
          duration: record.outputDuration,
          bytes: record.outputBytes,
          frames: 0,
          skippedFrames: 0,
          congestion: 0,
          bitrate: bitrate(record.outputBytes, this.snapshot.record.bytes),
        },
      })
    } catch (error) {
      if (structure) this.dirty = true
      throw error
    }
  }

  async preview(source: string, width = 640): Promise<string> {
    const result = await this.call('GetSourceScreenshot', {
      sourceName: source,
      imageFormat: 'jpeg',
      imageWidth: Math.max(64, Math.min(1280, Math.round(width))),
      imageCompressionQuality: 65,
    })
    return z.string().startsWith('data:image/').parse(result.imageData)
  }

  async setMetering(enabled: boolean): Promise<void> {
    if (this.disposed) return
    await this.bounded(
      this.obs.reidentify({
        eventSubscriptions:
          EventSubscription.All | (enabled ? EventSubscription.InputVolumeMeters : 0),
      }),
    )
    if (!enabled)
      this.update({ inputs: this.snapshot.inputs.map((input) => ({ ...input, levels: [] })) })
  }

  run(command: ObsRemoteCommand): Promise<void> {
    const task = this.commandTail.then(async () => {
      try {
        await this.execute(command)
      } finally {
        if (
          [
            'studio-mode',
            'transition',
            'scene-item',
            'switch-source',
            'rename-scene',
            'profile',
            'collection',
          ].includes(command.kind)
        )
          this.dirty = true
        const panicActive = this.panicMutes.size > 0
        if (panicActive !== this.snapshot.panicActive) this.update({ panicActive })
      }
      await this.refresh()
      if (this.dirty) await this.refresh()
    })
    this.commandTail = task.catch(() => {})
    return task
  }

  private async execute(command: ObsRemoteCommand): Promise<void> {
    switch (command.kind) {
      case 'program':
        await this.call('SetCurrentProgramScene', { sceneName: command.scene })
        this.setProgramScene(command.scene)
        break
      case 'preview':
        await this.call('SetCurrentPreviewScene', { sceneName: command.scene })
        this.update({ previewScene: command.scene })
        break
      case 'studio-mode':
        await this.call('SetStudioModeEnabled', { studioModeEnabled: command.enabled })
        break
      case 'transition':
        if (command.name)
          await this.call('SetCurrentSceneTransition', { transitionName: command.name })
        if (command.duration !== undefined) {
          const current = await this.call('GetCurrentSceneTransition')
          if (!current.transitionFixed)
            await this.call('SetCurrentSceneTransitionDuration', {
              transitionDuration: command.duration,
            })
        }
        await this.call('TriggerStudioModeTransition')
        break
      case 'scene-item':
        await this.call('SetSceneItemEnabled', {
          sceneName: command.scene,
          sceneItemId: command.id,
          sceneItemEnabled: command.enabled,
        })
        break
      case 'switch-source': {
        const result = await this.call(
          this.groups.has(command.scene) ? 'GetGroupSceneItemList' : 'GetSceneItemList',
          { sceneName: command.scene },
        )
        const items = z.array(itemSchema).parse(result.sceneItems)
        if (!items.some((item) => item.sceneItemId === command.id))
          throw new Error(t('notices.obs.sourceMissing'))
        await this.call('SetSceneItemEnabled', {
          sceneName: command.scene,
          sceneItemId: command.id,
          sceneItemEnabled: true,
        })
        for (const item of items) {
          if (item.sceneItemId !== command.id && item.sceneItemEnabled)
            await this.call('SetSceneItemEnabled', {
              sceneName: command.scene,
              sceneItemId: item.sceneItemId,
              sceneItemEnabled: false,
            })
        }
        break
      }
      case 'rename-scene':
        await this.call('SetSceneName', { sceneName: command.scene, newSceneName: command.name })
        break
      case 'stream':
        await this.call(command.active ? 'StartStream' : 'StopStream')
        break
      case 'virtual-camera':
        await this.call(command.active ? 'StartVirtualCam' : 'StopVirtualCam')
        break
      case 'replay-buffer':
        await this.call(command.active ? 'StartReplayBuffer' : 'StopReplayBuffer')
        break
      case 'record': {
        const requests = {
          start: 'StartRecord',
          stop: 'StopRecord',
          pause: 'PauseRecord',
          resume: 'ResumeRecord',
        } satisfies Record<typeof command.action, keyof OBSRequestTypes>
        await this.call(requests[command.action])
        break
      }
      case 'save-replay':
        await this.call('SaveReplayBuffer')
        break
      case 'profile':
        await this.call('SetCurrentProfile', { profileName: command.name })
        break
      case 'collection':
        await this.call('SetCurrentSceneCollection', { sceneCollectionName: command.name })
        break
      case 'mute':
        await this.call('SetInputMute', { inputName: command.input, inputMuted: command.muted })
        this.updateInput(command.input, { muted: command.muted })
        break
      case 'volume':
        await this.call('SetInputVolume', { inputName: command.input, inputVolumeDb: command.db })
        this.updateInput(command.input, { volumeDb: command.db })
        break
      case 'monitoring':
        await this.call('SetInputAudioMonitorType', {
          inputName: command.input,
          monitorType: command.mode,
        })
        this.updateInput(command.input, { monitoring: command.mode })
        break
      case 'panic':
        for (const input of this.snapshot.inputs) {
          if (!this.panicMutes.has(input.name)) {
            const state = await this.call('GetInputMute', { inputName: input.name })
            this.panicMutes.set(input.name, state.inputMuted)
          }
          await this.call('SetInputMute', { inputName: input.name, inputMuted: true })
          this.updateInput(input.name, { muted: true })
        }
        break
      case 'undo-panic':
        for (const [name, muted] of this.panicMutes) {
          try {
            await this.call('SetInputMute', { inputName: name, inputMuted: muted })
            this.updateInput(name, { muted })
          } catch (error) {
            if (!(error instanceof OBSWebSocketError) || error.code !== 600) throw error
          }
          this.panicMutes.delete(name)
        }
        break
      default: {
        const exhaustive: never = command
        throw new Error('Unknown OBS command', { cause: exhaustive })
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.cancellation.abort()
    this.stopTimer()
    this.obs.removeAllListeners()
    this.panicMutes.clear()
    await this.bounded(this.obs.disconnect(), true)
  }
}
