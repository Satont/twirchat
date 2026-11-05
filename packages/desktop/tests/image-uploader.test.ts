import { expect, test } from 'bun:test'
import { mkdtemp, rm, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_IMAGE_UPLOADER_SETTINGS,
  MAX_CLIPBOARD_IMAGE_BYTES,
  exportImageUploaderSettings,
  importImageUploaderSettings,
  readClipboardUploadFile,
  uploadClipboardImage,
  validateImageUploaderSettings,
} from '../src/services/image-uploader'

const png = Uint8Array.fromBase64(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
)
const image = { bytes: png, mimeType: 'image/png' }

test('ShareX profiles normalize JSON tokens and keep upload confirmation', () => {
  const settings = importImageUploaderSettings(
    JSON.stringify({
      Version: '16.1.0',
      RequestURL: 'https://uploader.example/upload',
      FileFormName: 'upload',
      URL: '{json:{response}|data.images[0].url}{json:ext}',
      DeletionURL: '{json:data.images[0].delete}',
      Headers: { 'x-api-key': 'account:key', cookie: 'test=a; example=b' },
    }),
    { ...DEFAULT_IMAGE_UPLOADER_SETTINGS, confirm: false },
  )

  expect(settings).toEqual({
    enabled: true,
    confirm: false,
    requestUrl: 'https://uploader.example/upload',
    formField: 'upload',
    imageLink: '{data.images.0.url}{ext}',
    deletionLink: '{data.images.0.delete}',
    headers: 'x-api-key: account:key; cookie: test=a; example=b',
  })
  const exported = exportImageUploaderSettings(settings)
  expect(JSON.parse(exported)).toMatchObject({
    RequestMethod: 'POST',
    Body: 'MultipartFormData',
    Headers: { 'x-api-key': 'account:key', cookie: 'test=a; example=b' },
  })
  expect(
    JSON.parse(exportImageUploaderSettings(importImageUploaderSettings(exported, settings))),
  ).toEqual(JSON.parse(exported))
  expect(
    importImageUploaderSettings(
      JSON.stringify({
        Version: '1.0',
        RequestURL: settings.requestUrl,
        FileFormName: settings.formField,
        URL: '{ReSpOnSe}',
      }),
      settings,
    ),
  ).toMatchObject({ imageLink: '', deletionLink: '', headers: '' })
})

test('validates the endpoint and preserves multipart framing', () => {
  const draft = {
    ...DEFAULT_IMAGE_UPLOADER_SETTINGS,
    enabled: true,
    requestUrl: 'https://uploader.example/upload',
    formField: 'upload',
  }
  expect(() => validateImageUploaderSettings({ ...draft, requestUrl: 'file:///tmp/file' })).toThrow(
    'HTTP or HTTPS',
  )
  expect(() =>
    validateImageUploaderSettings({ ...draft, headers: 'Content-Type: text/plain' }),
  ).toThrow('set by the uploader')
  expect(() => validateImageUploaderSettings({ ...draft, headers: 'Authorization' })).toThrow(
    'Name: value',
  )
  expect(() => importImageUploaderSettings('{}', draft)).toThrow('Copy uploader JSON')
})

test('uploads original image bytes in multipart form and extracts links', async () => {
  let requestCount = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      requestCount++
      expect(request.method).toBe('POST')
      expect(request.headers.get('authorization')).toBe('Basic account:key')
      expect(request.headers.get('x-other')).toBe('yes')
      const form = await request.formData()
      const file = form.get('upload')
      expect(file).toBeInstanceOf(File)
      if (!(file instanceof File)) throw new Error('Missing multipart file')
      expect(file.name).toBe('control_v.png')
      expect(file.type).toBe('image/png')
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(png)
      return new URL(request.url).pathname === '/raw'
        ? new Response(' https://images.example/raw.png\n')
        : Response.json({
            data: {
              images: [
                { url: 'https://images.example/a', delete: 'https://images.example/remove' },
              ],
            },
            extension: '.png',
          })
    },
  })
  const settings = validateImageUploaderSettings({
    ...DEFAULT_IMAGE_UPLOADER_SETTINGS,
    enabled: true,
    requestUrl: new URL('/json', server.url).href,
    formField: 'upload',
    headers: 'Authorization: Basic account:key; X-Other: yes',
    imageLink: '{data.images.0.url}{extension}',
    deletionLink: '{data.images.0.delete}',
  })
  try {
    const signal = new AbortController().signal
    expect(await uploadClipboardImage({ image, settings, signal })).toEqual({
      imageUrl: 'https://images.example/a.png',
      deletionUrl: 'https://images.example/remove',
    })
    expect(
      await uploadClipboardImage({
        image,
        settings: {
          ...settings,
          requestUrl: new URL('/raw', server.url).href,
          imageLink: '',
          deletionLink: '',
        },
        signal,
      }),
    ).toEqual({ imageUrl: 'https://images.example/raw.png', deletionUrl: null })
    expect(requestCount).toBe(2)
  } finally {
    await server.stop(true)
  }
})

test('refuses redirects and does not forward credentials or images', async () => {
  let redirected = false
  const receiver = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      redirected = true
      return new Response('https://images.example/redirect.png')
    },
  })
  const host = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      return Response.redirect(receiver.url, 307)
    },
  })
  try {
    const settings = validateImageUploaderSettings({
      ...DEFAULT_IMAGE_UPLOADER_SETTINGS,
      enabled: true,
      requestUrl: host.url.href,
      formField: 'upload',
      headers: 'X-Api-Key: private-value',
    })
    await expect(
      uploadClipboardImage({ image, settings, signal: new AbortController().signal }),
    ).rejects.toThrow('redirected')
    expect(redirected).toBe(false)
  } finally {
    await Promise.all([host.stop(true), receiver.stop(true)])
  }
})

test('bounds the response and releases the upload slot on failure and cancellation', async () => {
  const streaming = Promise.withResolvers<void>()
  const host = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      if (path === '/large') return new Response('x'.repeat(300 * 1024))
      if (path === '/slow')
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('partial response'))
              streaming.resolve()
            },
          }),
        )
      return new Response('https://images.example/success.png')
    },
  })
  const settings = validateImageUploaderSettings({
    ...DEFAULT_IMAGE_UPLOADER_SETTINGS,
    enabled: true,
    requestUrl: new URL('/large', host.url).href,
    formField: 'file',
  })
  const controller = new AbortController()
  try {
    await expect(
      uploadClipboardImage({ image, settings, signal: controller.signal }),
    ).rejects.toThrow('oversized response')
    const slow = uploadClipboardImage({
      image,
      settings: { ...settings, requestUrl: new URL('/slow', host.url).href },
      signal: controller.signal,
    })
    await streaming.promise
    await expect(
      uploadClipboardImage({ image, settings, signal: controller.signal }),
    ).rejects.toThrow('already in progress')
    controller.abort()
    await expect(slow).rejects.toThrow('canceled')
    expect(
      await uploadClipboardImage({
        image,
        settings: { ...settings, requestUrl: host.url.href },
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ imageUrl: 'https://images.example/success.png' })
  } finally {
    await host.stop(true)
  }
})

test('reads bounded local raster images and rejects a text file with an image extension', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'twirchat-image-upload-'))
  try {
    const imagePath = join(dir, 'image.PNG')
    const fakePath = join(dir, 'fake.png')
    await Bun.write(imagePath, png)
    await Bun.write(fakePath, 'not an image')
    expect(await readClipboardUploadFile(imagePath)).toEqual(image)
    expect(await readClipboardUploadFile(fakePath)).toBeNull()
    expect(await readClipboardUploadFile('relative.png')).toBeNull()
    await truncate(imagePath, MAX_CLIPBOARD_IMAGE_BYTES + 1)
    await expect(readClipboardUploadFile(imagePath)).rejects.toThrow('exceeds 20 MiB')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
