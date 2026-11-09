import { useGpuixRequired, type PublicInstance } from '@gpuix/react'
import { useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react'

import {
  isClipboardImagePath,
  type ClipboardUploadImage,
  type ImageUploaderSettings,
  type ImageUploadResult,
} from '../../services/image-uploader'
import { useBackend } from '../backend/context'
import { t as translate, tPlural as translatePlural, useT } from '../i18n'
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
      return translate('composer.image.preparing')
    case 'confirm':
      return translatePlural('composer.image.confirm', view.count)
    case 'uploading':
      return view.count === 1
        ? translate('composer.image.uploadingSingle')
        : translate('composer.image.uploading', { index: view.index, count: view.count })
    case 'failed':
      return view.message
    case 'complete':
      return translatePlural('composer.image.uploaded', view.count)
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
  const { t, tPlural } = useT()
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
      showNotice('success', t('composer.image.uploadedLinkCopied'))
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
        throw new Error(t('composer.image.error.settingsChanged'))
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
        if (!session.next) throw new Error(t('composer.image.error.noSupportedImages'))
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
          message: error instanceof Error ? error.message : t('composer.image.error.upload'),
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
      setView({
        kind: 'failed',
        message: t('composer.image.error.noSupportedImages'),
        retry: false,
      })
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
      if (!image) throw new Error(t('composer.image.error.noSupportedImages'))
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
          message: error instanceof Error ? error.message : t('composer.image.error.read'),
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
        showNotice('error', t('composer.image.error.paste'))
      })
    })
    return () => {
      active = false
      native.setImagePasteHandler(editorId, null)
      sessionRef.current?.controller.abort()
      sessionRef.current = null
    }
  }, [editor, renderer, t])

  if (!view) return null
  const start = (remember: boolean) => {
    const session = sessionRef.current
    if (session) {
      void upload(session, remember).catch(() =>
        showNotice('error', t('composer.image.error.upload')),
      )
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
            {t('composer.image.confirmHint', { host: view.host })}
          </Text>
        </>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {view.kind === 'confirm' ? (
          <>
            <ActionButton primary testId="composer-image-upload" onClick={() => start(false)}>
              {t('common.upload')}
            </ActionButton>
            <ActionButton testId="composer-image-upload-remember" onClick={() => start(true)}>
              {t('composer.image.uploadAndDontAsk')}
            </ActionButton>
          </>
        ) : null}
        {view.kind === 'failed' && view.retry ? (
          <ActionButton primary testId="composer-image-retry" onClick={() => start(false)}>
            {t('common.retry')}
          </ActionButton>
        ) : null}
        {deletionUrls.length ? (
          <ActionButton
            testId="composer-image-copy-deletion"
            onClick={() => {
              void api.copyText({ text: deletionUrls.join('\n') }).then(
                () => showNotice('success', t('composer.image.deletionCopied')),
                () => showNotice('error', t('composer.image.error.copyDeletion')),
              )
            }}
          >
            {tPlural('composer.image.copyDeletionLink', deletionUrls.length)}
          </ActionButton>
        ) : null}
        <ActionButton
          testId="composer-image-cancel"
          onClick={() => {
            cancel()
            if (editor.current) renderer.focusElement?.(editor.current.id)
          }}
        >
          {view.kind === 'complete' || view.kind === 'failed'
            ? t('composer.dismiss')
            : t('common.cancel')}
        </ActionButton>
      </div>
    </div>
  )
}
