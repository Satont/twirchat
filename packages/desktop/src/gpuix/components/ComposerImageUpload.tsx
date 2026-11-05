import { useGpuixRequired, type PublicInstance } from '@gpuix/react'
import { useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react'

import {
  isClipboardImagePath,
  type ClipboardUploadImage,
  type ImageUploaderSettings,
  type ImageUploadResult,
} from '../../services/image-uploader'
import { useBackend } from '../backend/context'
import { nativeWindow, type NativeImagePaste } from '../native-window'
import { showNotice } from '../state/app'
import { useStoreSelector } from '../state/create-store'
import {
  applyImageUploaderSettings,
  imageUploaderSettingsStore,
  loadImageUploaderSettings,
} from '../state/image-uploader'
import { useTheme } from '../theme-context'
import { ActionButton } from './ui/Form'
import { Text } from './ui/Text'

type ImageSource = { kind: 'image'; image: ClipboardUploadImage } | { kind: 'file'; path: string }

interface UploadSession {
  controller: AbortController
  editorId: number
  settings: ImageUploaderSettings
  sources: ImageSource[]
  next: number
  current: ClipboardUploadImage | null
  deletionUrls: string[]
}

type UploadView =
  | { kind: 'preparing' }
  | { kind: 'confirm'; host: string; count: number; preview: string | null }
  | { kind: 'uploading'; index: number; count: number }
  | { kind: 'failed'; message: string; retry: boolean }
  | { kind: 'complete'; count: number }

function uploadTitle(view: UploadView): string {
  switch (view.kind) {
    case 'preparing':
      return 'Preparing image…'
    case 'confirm':
      return view.count === 1 ? 'Upload this image?' : `Upload ${view.count} images?`
    case 'uploading':
      return view.count === 1
        ? 'Uploading image…'
        : `Uploading image ${view.index} of ${view.count}…`
    case 'failed':
      return view.message
    case 'complete':
      return view.count === 1 ? 'Image uploaded' : `${view.count} images uploaded`
    default: {
      const exhaustive: never = view
      return exhaustive
    }
  }
}

async function previewImage(image: ClipboardUploadImage): Promise<string | null> {
  if (
    !['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/tiff'].includes(image.mimeType)
  )
    return null
  try {
    const { default: sharp } = await import('sharp')
    const preview = await sharp(image.bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 288, height: 144, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
    return `data:image/png;base64,${preview.toString('base64')}`
  } catch {
    return null
  }
}

export function ComposerImageUpload({ editor }: { editor: RefObject<PublicInstance | null> }) {
  const { api } = useBackend()
  const enabled = useStoreSelector(imageUploaderSettingsStore, (value) => value?.enabled ?? false)
  useEffect(() => {
    void loadImageUploaderSettings(api).catch(() => {
      // Settings shows load failures and lets the user retry.
    })
  }, [api])
  return enabled ? <EnabledComposerImageUpload editor={editor} /> : null
}

function EnabledComposerImageUpload({ editor }: { editor: RefObject<PublicInstance | null> }) {
  const renderer = useGpuixRequired()
  const { api } = useBackend()
  const theme = useTheme()
  const sessionRef = useRef<UploadSession | null>(null)
  const busy = useRef(false)
  const [view, setView] = useState<UploadView | null>(null)
  const [deletionUrls, setDeletionUrls] = useState<string[]>([])

  function finish(session: UploadSession) {
    sessionRef.current = null
    if (session.next) {
      setView({ kind: 'complete', count: session.next })
    } else {
      setView(null)
    }
  }

  function cancel() {
    const session = sessionRef.current
    if (session) {
      session.controller.abort()
      finish(session)
    } else {
      setView(null)
      setDeletionUrls([])
    }
  }

  async function nextImage(session: UploadSession): Promise<ClipboardUploadImage | null> {
    while (!session.current && !session.controller.signal.aborted) {
      const source = session.sources[session.next]
      if (!source) break
      if (source.kind === 'image') session.current = source.image
      else {
        // Keep at most one copied file's bytes in memory.
        // eslint-disable-next-line no-await-in-loop
        session.current = await api.readClipboardUploadFile(source.path)
      }
      if (!session.current) session.sources.splice(session.next, 1)
    }
    return session.current
  }

  async function insertResult(session: UploadSession, result: ImageUploadResult) {
    session.next++
    session.current = null
    if (result.deletionUrl) {
      session.deletionUrls.push(result.deletionUrl)
      setDeletionUrls([...session.deletionUrls])
    }
    const inserted = await nativeWindow(renderer).insertTextInEditor(
      session.editorId,
      `${result.imageUrl} `,
    )
    if (!inserted && !session.controller.signal.aborted) {
      await api.copyText({ text: result.imageUrl })
      showNotice('success', 'Image uploaded. Link copied to the clipboard.')
    }
  }

  async function uploadNext(session: UploadSession): Promise<boolean> {
    const { signal } = session.controller
    const image = await nextImage(session)
    if (!image || signal.aborted) return false
    setView({ kind: 'uploading', index: session.next + 1, count: session.sources.length })
    const result = await api.uploadClipboardImage({ image, settings: session.settings, signal })
    if (signal.aborted) return false
    await insertResult(session, result)
    return !signal.aborted
  }

  async function upload(session: UploadSession, remember: boolean) {
    if (busy.current || sessionRef.current !== session) return
    busy.current = true
    setView({ kind: 'uploading', index: session.next + 1, count: session.sources.length })
    const { signal } = session.controller
    try {
      if (imageUploaderSettingsStore.get() !== session.settings)
        throw new Error('Image uploader settings changed. Paste the image again.')
      if (remember) {
        session.settings = await api.saveImageUploaderSettings({
          ...session.settings,
          confirm: false,
        })
        applyImageUploaderSettings(session.settings)
      }
      // Upload in clipboard order, preserving already inserted links when a later file fails.
      // eslint-disable-next-line no-await-in-loop
      while (await uploadNext(session)) {
        /* Advance until the batch ends. */
      }
      if (!signal.aborted) {
        if (!session.next) throw new Error('The clipboard has no supported images.')
        finish(session)
      }
    } catch (error) {
      if (!signal.aborted) {
        const retry =
          session.next < session.sources.length &&
          imageUploaderSettingsStore.get() === session.settings
        if (!retry) sessionRef.current = null
        setView({
          kind: 'failed',
          message: error instanceof Error ? error.message : 'Could not upload the image.',
          retry,
        })
      }
    } finally {
      busy.current = false
    }
  }

  const receive = useEffectEvent(async (paste: NativeImagePaste, editorId: number) => {
    const settings = imageUploaderSettingsStore.get()
    if (!settings?.enabled || sessionRef.current || busy.current) return
    setDeletionUrls([])
    if ('error' in paste) {
      setView({ kind: 'failed', message: paste.error, retry: false })
      return
    }
    const sources: ImageSource[] =
      'paths' in paste
        ? paste.paths.filter(isClipboardImagePath).map((path) => ({ kind: 'file', path }))
        : [{ kind: 'image', image: paste }]
    if (!sources.length) {
      setView({ kind: 'failed', message: 'The clipboard has no supported images.', retry: false })
      return
    }
    const session: UploadSession = {
      controller: new AbortController(),
      editorId,
      settings,
      sources,
      next: 0,
      current: null,
      deletionUrls: [],
    }
    sessionRef.current = session
    if (!settings.confirm) {
      await upload(session, false)
      return
    }
    setView({ kind: 'preparing' })
    try {
      const image = await nextImage(session)
      if (session.controller.signal.aborted) return
      if (!image) throw new Error('The clipboard has no supported images.')
      const preview = await previewImage(image)
      if (session.controller.signal.aborted) return
      setView({
        kind: 'confirm',
        host: new URL(settings.requestUrl).host,
        count: session.sources.length,
        preview,
      })
    } catch (error) {
      if (!session.controller.signal.aborted) {
        sessionRef.current = null
        setView({
          kind: 'failed',
          message: error instanceof Error ? error.message : 'Could not read the image.',
          retry: false,
        })
      }
    }
  })

  useEffect(() => {
    const editorId = editor.current?.id
    if (editorId === undefined) return undefined
    const native = nativeWindow(renderer)
    let active = true
    native.setImagePasteHandler(editorId, (paste) => {
      if (!active) return
      void receive(paste, editorId).catch(() => {
        showNotice('error', 'Could not paste the image.')
      })
    })
    return () => {
      active = false
      native.setImagePasteHandler(editorId, null)
      sessionRef.current?.controller.abort()
      sessionRef.current = null
    }
  }, [editor, renderer])

  if (!view) return null
  const start = (remember: boolean) => {
    const session = sessionRef.current
    if (session) {
      void upload(session, remember).catch(() => showNotice('error', 'Could not upload the image.'))
    }
  }

  return (
    <div
      testId={`composer-image-${view.kind}`}
      onKeyDown={(event) => {
        if (event.key !== 'escape') return
        event.preventDefault()
        cancel()
        if (editor.current) renderer.focusElement?.(editor.current.id)
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        borderRadius: 6,
        backgroundColor: theme.fill,
        minWidth: 0,
      }}
    >
      <Text style={{ fontSize: 12, color: view.kind === 'failed' ? theme.dangerText : theme.text }}>
        {uploadTitle(view)}
      </Text>
      {view.kind === 'confirm' ? (
        <>
          {view.preview ? (
            <img
              testId="composer-image-preview"
              src={view.preview}
              objectFit="contain"
              style={{ width: 144, height: 72, maxWidth: '100%' }}
            />
          ) : null}
          <Text style={{ fontSize: 11, color: theme.text2 }}>
            {`To ${view.host}. The link will be inserted into your draft.`}
          </Text>
        </>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {view.kind === 'confirm' ? (
          <>
            <ActionButton primary testId="composer-image-upload" onClick={() => start(false)}>
              Upload
            </ActionButton>
            <ActionButton testId="composer-image-upload-remember" onClick={() => start(true)}>
              Upload and don’t ask again
            </ActionButton>
          </>
        ) : null}
        {view.kind === 'failed' && view.retry ? (
          <ActionButton primary testId="composer-image-retry" onClick={() => start(false)}>
            Retry
          </ActionButton>
        ) : null}
        {deletionUrls.length ? (
          <ActionButton
            testId="composer-image-copy-deletion"
            onClick={() => {
              void api.copyText({ text: deletionUrls.join('\n') }).then(
                () => showNotice('success', 'Deletion link copied.'),
                () => showNotice('error', 'Could not copy the deletion link.'),
              )
            }}
          >
            {deletionUrls.length === 1 ? 'Copy deletion link' : 'Copy deletion links'}
          </ActionButton>
        ) : null}
        <ActionButton
          testId="composer-image-cancel"
          onClick={() => {
            cancel()
            if (editor.current) renderer.focusElement?.(editor.current.id)
          }}
        >
          {view.kind === 'complete' || view.kind === 'failed' ? 'Dismiss' : 'Cancel'}
        </ActionButton>
      </div>
    </div>
  )
}
