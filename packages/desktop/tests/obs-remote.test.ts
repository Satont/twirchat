import { afterEach, expect, test } from 'bun:test'

import { z } from 'zod'

import {
  createObsRemoteSnapshot,
  obsActiveSources,
  ObsRemoteSession,
} from '../src/services/obs-remote'
import type { ObsRemoteSnapshot } from '../src/services/obs-remote'

const requestSchema = z.object({
  op: z.number(),
  d: z
    .object({
      requestId: z.string(),
      requestType: z.string(),
      requestData: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
})
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

function fixture(holdHello = false) {
  const requests: string[] = []
  const mutes = new Map([
    ['Microphone', false],
    ['Desktop', true],
  ])
  let pendingScreenshot = false
  let snapshot: ObsRemoteSnapshot = createObsRemoteSnapshot()
  const output = {
    outputActive: false,
    outputPaused: false,
    outputDuration: 0,
    outputBytes: 0,
    outputTotalFrames: 0,
    outputSkippedFrames: 0,
    outputCongestion: 0,
  }
  const responses: Record<string, unknown> = {
    GetVersion: { obsVersion: '33.0.0' },
    GetSceneList: {
      scenes: [{ sceneName: 'Main' }],
      currentProgramSceneName: 'Main',
      currentPreviewSceneName: null,
    },
    GetStudioModeEnabled: { studioModeEnabled: false },
    GetSceneTransitionList: {
      transitions: [{ transitionName: 'Cut', transitionKind: 'cut_transition' }],
      currentSceneTransitionName: 'Cut',
    },
    GetCurrentSceneTransition: { transitionDuration: null, transitionFixed: true },
    GetProfileList: { profiles: ['Default'], currentProfileName: 'Default' },
    GetSceneCollectionList: {
      sceneCollections: ['Collection'],
      currentSceneCollectionName: 'Collection',
    },
    GetInputList: { inputs: [{ inputName: 'Microphone' }, { inputName: 'Image' }] },
    GetSpecialInputs: {
      desktop1: 'Desktop',
      desktop2: null,
      mic1: null,
      mic2: null,
      mic3: null,
      mic4: null,
    },
    GetSceneItemList: {
      sceneItems: [
        {
          sceneItemId: 1,
          sourceName: 'Microphone',
          sceneItemEnabled: true,
          isGroup: null,
          inputKind: 'pulse_input_capture',
          sourceType: 'OBS_SOURCE_TYPE_INPUT',
        },
      ],
    },
    GetInputVolume: { inputVolumeDb: -12, inputVolumeMul: 0.25 },
    GetInputAudioMonitorType: { monitorType: 'OBS_MONITORING_TYPE_NONE' },
    GetStreamStatus: output,
    GetRecordStatus: output,
    GetVirtualCamStatus: output,
    GetReplayBufferStatus: output,
    GetStats: {
      cpuUsage: 1,
      memoryUsage: 100,
      availableDiskSpace: 1000,
      activeFps: 60,
      averageFrameRenderTime: 1,
      renderSkippedFrames: 0,
      renderTotalFrames: 100,
      outputSkippedFrames: 0,
      outputTotalFrames: 100,
    },
    GetSourceScreenshot: { imageData: 'data:image/jpeg;base64,AA==' },
  }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, currentServer) {
      if (currentServer.upgrade(request)) return undefined
      return new Response('', { status: 400 })
    },
    websocket: {
      open(socket) {
        if (holdHello) return
        socket.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.6.0', rpcVersion: 1 } }))
      },
      message(socket, message) {
        const envelope: unknown = JSON.parse(String(message))
        const op = z.object({ op: z.number() }).parse(envelope).op
        if (op === 1 || op === 3) {
          socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }))
          return
        }
        const { d } = requestSchema.parse(envelope)
        if (!d) return
        requests.push(d.requestType)
        if (d.requestType === 'GetSourceScreenshot' && pendingScreenshot) return
        const inputName = d.requestData?.inputName
        if (
          (d.requestType === 'GetInputVolume' && inputName === 'Image') ||
          d.requestType === 'GetVirtualCamStatus'
        ) {
          socket.send(
            JSON.stringify({
              op: 7,
              d: {
                requestId: d.requestId,
                requestType: d.requestType,
                requestStatus: {
                  result: false,
                  code: 604,
                  comment: 'Resource unavailable',
                },
              },
            }),
          )
          return
        }
        if (d.requestType === 'SetInputMute' && typeof inputName === 'string') {
          mutes.set(inputName, z.boolean().parse(d.requestData?.inputMuted))
        }
        const responseData =
          d.requestType === 'GetInputMute' && typeof inputName === 'string'
            ? { inputMuted: mutes.get(inputName) ?? false }
            : (responses[d.requestType] ?? {})
        socket.send(
          JSON.stringify({
            op: 7,
            d: {
              requestId: d.requestId,
              requestType: d.requestType,
              requestStatus: { result: true, code: 100 },
              responseData,
            },
          }),
        )
      },
    },
  })
  const session = new ObsRemoteSession(`ws://127.0.0.1:${server.port}`, '', (next) => {
    snapshot = next
  })
  cleanups.push(async () => {
    await session.dispose()
    await server.stop(true)
  })
  return {
    session,
    requests,
    mutes,
    snapshot: () => snapshot,
    holdScreenshot: () => {
      pendingScreenshot = true
    },
  }
}

test('connects to OBS v5 and includes global audio inputs absent from input list', async () => {
  const obs = fixture()
  await obs.session.connect()
  expect(obs.snapshot().connected).toBe(true)
  expect(obs.snapshot().version).toBe('33.0.0')
  expect(obs.snapshot().virtualCameraAvailable).toBe(false)
  expect(
    obs
      .snapshot()
      .inputs.map((input) => input.name)
      .toSorted(),
  ).toEqual(['Desktop', 'Microphone'])
  expect(obs.snapshot().inputs.find((input) => input.name === 'Desktop')).toMatchObject({
    global: true,
    active: true,
    muted: true,
  })
  expect(await obs.session.preview('Main')).toBe('data:image/jpeg;base64,AA==')
})

test('panic restores original mute states and mixer edits do not reload scene topology', async () => {
  const obs = fixture()
  await obs.session.connect()
  const topologyRequests = obs.requests.filter((request) => request === 'GetSceneItemList').length
  await obs.session.run({ kind: 'panic' })
  await obs.session.run({ kind: 'panic' })
  expect(obs.mutes.get('Microphone')).toBe(true)
  expect(obs.snapshot().panicActive).toBe(true)
  await obs.session.run({ kind: 'undo-panic' })
  expect(obs.mutes.get('Microphone')).toBe(false)
  expect(obs.mutes.get('Desktop')).toBe(true)
  expect(obs.snapshot().panicActive).toBe(false)
  await obs.session.run({ kind: 'volume', input: 'Microphone', db: -20 })
  expect(obs.snapshot().inputs.find((input) => input.name === 'Microphone')?.volumeDb).toBe(-20)
  expect(obs.requests.filter((request) => request === 'GetSceneItemList')).toHaveLength(
    topologyRequests,
  )
})

test('fixed transitions ignore supplied durations', async () => {
  const obs = fixture()
  await obs.session.connect()
  await obs.session.run({ kind: 'transition', name: 'Cut', duration: 300 })
  expect(obs.requests).toContain('TriggerStudioModeTransition')
  expect(obs.requests).not.toContain('SetCurrentSceneTransitionDuration')
})

test('dispose cancels pending requests and stops publishing', async () => {
  const obs = fixture()
  await obs.session.connect()
  obs.holdScreenshot()
  const screenshot = obs.session.preview('Main')
  const rejected = screenshot.then(
    () => {
      throw new Error('Expected cancellation')
    },
    (error: unknown) => {
      expect(error).toEqual(new Error('OBS session is closed'))
    },
  )
  await obs.session.dispose()
  await rejected
  const previous = obs.snapshot()
  await expect(obs.session.run({ kind: 'stream', active: true })).rejects.toThrow(
    'OBS session is closed',
  )
  expect(obs.snapshot()).toBe(previous)
})

test('active source traversal excludes children of hidden groups', () => {
  const item = {
    id: 1,
    scene: 'Main',
    name: 'Group',
    enabled: false,
    kind: 'group',
    children: [{ id: 2, scene: 'Group', name: 'Mic', enabled: true, kind: 'audio', children: [] }],
  }
  expect([...obsActiveSources([item])]).toEqual([])
  expect([...obsActiveSources([{ ...item, enabled: true }])]).toEqual(['Group', 'Mic'])
})

test('dispose cancels a connection awaiting the OBS hello handshake', async () => {
  const obs = fixture(true)
  const connecting = obs.session.connect().then(
    () => {
      throw new Error('Expected cancelled connection')
    },
    (error: unknown) => {
      expect(error).toEqual(new Error('OBS session is closed'))
    },
  )
  await obs.session.dispose()
  await connecting
  expect(obs.snapshot().connected).toBe(false)
})
