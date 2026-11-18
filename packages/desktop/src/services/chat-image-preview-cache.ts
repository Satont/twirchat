import { deleteOldestEntry } from './bounded-cache'
import { fetchChatImage } from './chat-image-preview'

export interface ChatImagePreview {
  thumbnail: string
  full: string
  width: number
  height: number
}

interface PreviewJob {
  users: number
  controller: AbortController
  run(): void
  cancel(): void
  result: Promise<ChatImagePreview | undefined>
}

const MAX_ACTIVE = 2
const MAX_QUEUED = 24
const CACHE_TTL = 5 * 60_000
const MAX_CACHED = 48

function imageSource(data: Buffer): string {
  return `data:image/webp;base64,${data.toString('base64')}`
}

async function prepareImage(
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<ChatImagePreview | undefined> {
  if (signal.aborted) return undefined
  const { default: sharp } = await import('sharp')
  const full = await sharp(bytes, { limitInputPixels: 16_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 86 })
    .toBuffer()
  if (signal.aborted || full.length > 1024 * 1024) return undefined
  const preview = await sharp(full)
    .resize({ width: 240, height: 160, fit: 'inside', withoutEnlargement: true })
    .webp()
    .toBuffer({ resolveWithObject: true })
  return {
    thumbnail: imageSource(preview.data),
    full: imageSource(full),
    width: preview.info.width,
    height: preview.info.height,
  }
}

export function createChatImagePreviewCache({ load = fetchChatImage, now = Date.now } = {}) {
  const cache = new Map<string, { image: ChatImagePreview | undefined; expires: number }>()
  const jobs = new Map<string, PreviewJob>()
  const queued = new Map<string, PreviewJob>()
  let active = 0

  function drain() {
    while (active < MAX_ACTIVE) {
      const next = queued.entries().next()
      if (next.done) return
      const [url, job] = next.value
      queued.delete(url)
      active++
      job.run()
    }
  }

  function release(url: string, job: PreviewJob) {
    if (--job.users !== 0 || jobs.get(url) !== job) return
    jobs.delete(url)
    job.controller.abort()
    // A queued job hasn't started but must still settle for its subscribers.
    if (queued.delete(url)) job.cancel()
  }

  return (url: string, signal: AbortSignal): Promise<ChatImagePreview | undefined> => {
    if (signal.aborted) return Promise.resolve(undefined)
    const cached = cache.get(url)
    if (cached && now() < cached.expires) return Promise.resolve(cached.image)
    let job = jobs.get(url)
    if (!job) {
      if (queued.size >= MAX_QUEUED) return Promise.resolve(undefined)
      const controller = new AbortController()
      const { promise: result, resolve } = Promise.withResolvers<ChatImagePreview | undefined>()
      job = {
        users: 0,
        controller,
        result,
        cancel: () => resolve(undefined),
        run: () => {
          const current = job
          const request = async () => {
            let image: ChatImagePreview | undefined
            try {
              if (!controller.signal.aborted) {
                const bytes = await load(url, controller.signal)
                if (bytes) image = await prepareImage(bytes, controller.signal)
              }
            } catch {
              // Untrusted or undecodable images leave the original link alone.
            }
            if (jobs.get(url) === current) jobs.delete(url)
            if (!controller.signal.aborted) {
              cache.delete(url)
              cache.set(url, { image, expires: now() + CACHE_TTL })
              if (cache.size > MAX_CACHED) deleteOldestEntry(cache)
            }
            resolve(image)
            active--
            drain()
          }
          request().catch(console.error)
        },
      }
      jobs.set(url, job)
      queued.set(url, job)
    }
    const current = job
    current.users++
    const cancel = () => release(url, current)
    signal.addEventListener('abort', cancel, { once: true })
    drain()
    return current.result.then((image) => {
      signal.removeEventListener('abort', cancel)
      return signal.aborted ? undefined : image
    })
  }
}
