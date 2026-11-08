import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'

import {
  connectTwirImageUploader,
  disconnectTwirImageUploader,
  getImageUploaderSettings,
  saveImageUploaderSettings,
  uploadClipboardImage,
} from '../src/gpuix/backend/image-uploader'
import {
  DEFAULT_IMAGE_UPLOADER_SETTINGS,
  exportImageUploaderSettings,
} from '../src/services/image-uploader'
import { initDb } from '../src/store/db'

const loopbackFetch = fetch
const uploadUrl = 'https://twir.app/api/v1/uploader/files'
const image = {
  mimeType: 'image/png',
  bytes: new Uint8Array(33),
}
image.bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
let db: Database

beforeEach(() => {
  db = initDb(':memory:')
})

afterEach(() => {
  db.close()
})

function beginSignIn() {
  const controller = new AbortController()
  const opened = Promise.withResolvers<URL>()
  const result = connectTwirImageUploader({ signal: controller.signal }, async (url) => {
    opened.resolve(new URL(url))
  })
  return { controller, opened: opened.promise, result }
}

function callbackUrl(authorization: URL): URL {
  const callback = new URL(authorization.searchParams.get('redirect_uri') ?? '')
  callback.searchParams.set('state', authorization.searchParams.get('state') ?? '')
  return callback
}

function tokenReply(label: string, expiresIn: number): Response {
  return Response.json({
    access_token: `access-${label}`,
    refresh_token: `refresh-${label}`,
    expires_in: expiresIn,
    token_type: 'Bearer',
    scope: 'files:edit',
  })
}

function mockProvider(handle: (request: Request) => Promise<Response>) {
  const request = (...args: Parameters<typeof fetch>) => handle(new Request(...args))
  return spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(request, { preconnect: loopbackFetch.preconnect }),
  )
}

test('Twir sign-in uses PKCE and uploads only to Twir, preserving manual settings on disconnect', async () => {
  const manual = await saveImageUploaderSettings({
    ...DEFAULT_IMAGE_UPLOADER_SETTINGS,
    enabled: true,
    confirm: false,
    requestUrl: 'https://custom.example/upload',
    formField: 'attachment',
    headers: 'Authorization: Bearer manual-credential',
  })
  const tokenRequests: URLSearchParams[] = []
  const uploads: Request[] = []
  const revoked = Promise.withResolvers<URLSearchParams>()
  const provider = mockProvider(async (request) => {
    switch (request.url) {
      case 'https://twir.app/api/oauth/token': {
        const form = new URLSearchParams(await request.text())
        tokenRequests.push(form)
        return form.get('grant_type') === 'authorization_code'
          ? tokenReply('initial', 15)
          : tokenReply('rotated', 3600)
      }
      case 'https://twir.app/api/oauth/revoke':
        revoked.resolve(new URLSearchParams(await request.text()))
        return new Response()
      case uploadUrl:
        uploads.push(request)
        return Response.json({
          data: {
            link: 'https://twir.app/files/image',
            delete_link: 'https://twir.app/files/delete',
          },
        })
      default:
        throw new Error('Unexpected network destination.')
    }
  })
  const signIn = beginSignIn()
  try {
    const authorize = await signIn.opened
    const callback = callbackUrl(authorize)
    const fakeDenial = new URL(callback)
    fakeDenial.search = 'state=wrong&error=access_denied'
    expect((await loopbackFetch(fakeDenial)).status).toBe(400)
    expect((await loopbackFetch(callback, { method: 'POST' })).status).toBe(404)
    expect(tokenRequests).toHaveLength(0)
    callback.searchParams.set('code', 'one-time-code')
    expect((await loopbackFetch(callback)).status).toBe(200)

    const twir = await signIn.result
    const exchange = tokenRequests[0]
    expect(authorize.origin + authorize.pathname).toBe('https://twir.app/api/oauth/authorize')
    expect(authorize.searchParams.get('scope')).toBe('files:edit')
    expect(authorize.searchParams.get('response_type')).toBe('code')
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(exchange?.get('client_id')).toBe(authorize.searchParams.get('client_id'))
    expect(exchange?.get('code')).toBe('one-time-code')
    expect(exchange?.get('redirect_uri')).toBe(authorize.searchParams.get('redirect_uri'))
    expect(exchange?.get('resource')).toBe('https://twir.app/api')
    expect(
      createHash('sha256')
        .update(exchange?.get('code_verifier') ?? '')
        .digest('base64url'),
    ).toBe(authorize.searchParams.get('code_challenge') ?? '')
    expect(twir).toMatchObject({
      provider: 'twir',
      requestUrl: uploadUrl,
      enabled: true,
      confirm: false,
      headers: '',
    })
    expect(() => exportImageUploaderSettings(twir)).toThrow('cannot be exported')
    const signal = AbortSignal.timeout(2_000)
    await expect(
      uploadClipboardImage({
        image,
        signal,
        settings: { ...twir, requestUrl: 'https://custom.example/upload' },
      }),
    ).rejects.toThrow('settings changed')
    expect(uploads).toHaveLength(0)

    const updated = await saveImageUploaderSettings({ ...twir, confirm: true })
    expect(await getImageUploaderSettings()).toEqual(updated)
    expect(await uploadClipboardImage({ image, settings: updated, signal })).toEqual({
      imageUrl: 'https://twir.app/files/image',
      deletionUrl: 'https://twir.app/files/delete',
    })
    expect(tokenRequests[1]?.get('refresh_token')).toBe('refresh-initial')
    expect(uploads[0]?.headers.get('Authorization')).toBe('Bearer access-rotated')
    expect(uploads[0]?.redirect).toBe('manual')
    const form = await uploads[0]?.formData()
    expect(form?.get('file')).toBeInstanceOf(File)

    expect(await disconnectTwirImageUploader()).toEqual(manual)
    expect((await revoked.promise).get('token')).toBe('refresh-rotated')
    expect(await getImageUploaderSettings()).toEqual(manual)
  } finally {
    signIn.controller.abort()
    await signIn.result.catch(() => {})
    provider.mockRestore()
  }
})

test('denial and cancellation close the callback listener without enabling uploads', async () => {
  const denied = beginSignIn()
  const deniedCallback = callbackUrl(await denied.opened)
  deniedCallback.searchParams.set('error', 'access_denied')
  const denial = denied.result.catch((error: unknown) => error)
  expect((await loopbackFetch(deniedCallback)).status).toBe(400)
  expect(await denial).toEqual(new Error('Twir sign-in was declined or did not complete.'))
  await expect(loopbackFetch(deniedCallback)).rejects.toThrow()

  const canceled = beginSignIn()
  const canceledCallback = callbackUrl(await canceled.opened)
  canceled.controller.abort()
  await expect(canceled.result).rejects.toThrow()
  await expect(loopbackFetch(canceledCallback)).rejects.toThrow()
  expect(await getImageUploaderSettings()).toEqual(DEFAULT_IMAGE_UPLOADER_SETTINGS)
})

test('disconnect during token rotation keeps the session disconnected', async () => {
  const refreshStarted = Promise.withResolvers<void>()
  const refreshReply = Promise.withResolvers<Response>()
  const revoked = Promise.withResolvers<void>()
  const provider = mockProvider(async (request) => {
    if (request.url === 'https://twir.app/api/oauth/revoke') {
      revoked.resolve()
      return new Response()
    }
    if (request.url !== 'https://twir.app/api/oauth/token')
      throw new Error('Unexpected network destination.')
    const form = new URLSearchParams(await request.text())
    if (form.get('grant_type') === 'authorization_code') return tokenReply('initial', 15)
    refreshStarted.resolve()
    return refreshReply.promise
  })
  const signIn = beginSignIn()
  try {
    const callback = callbackUrl(await signIn.opened)
    callback.searchParams.set('code', 'one-time-code')
    expect((await loopbackFetch(callback)).status).toBe(200)
    const settings = await signIn.result
    const pendingUpload = uploadClipboardImage({
      image,
      settings,
      signal: AbortSignal.timeout(2_000),
    })
    const rejected = pendingUpload.catch((error: unknown) => error)
    await refreshStarted.promise
    expect(await disconnectTwirImageUploader()).toEqual(DEFAULT_IMAGE_UPLOADER_SETTINGS)
    await revoked.promise
    refreshReply.resolve(tokenReply('stale', 3600))
    expect(await rejected).toMatchObject({ message: expect.stringContaining('Reconnect') })
    expect(await getImageUploaderSettings()).toEqual(DEFAULT_IMAGE_UPLOADER_SETTINGS)
  } finally {
    signIn.controller.abort()
    refreshReply.resolve(new Response(null, { status: 500 }))
    await signIn.result.catch(() => {})
    provider.mockRestore()
  }
})
