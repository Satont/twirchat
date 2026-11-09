import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, realpathSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'

interface PrimaryInstance {
  kind: 'primary'
  bindActivation: (activate: () => boolean) => void
  stopActivation: () => Promise<void>
}

type SingleInstance = PrimaryInstance | { kind: 'forwarded' } | { kind: 'unsupported' }

declare global {
  var __twirchatLinuxInstance: PrimaryInstance | undefined
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    const parent = dirname(path)
    if (parent === path) throw error
    return join(canonicalPath(parent), path.slice(parent.length))
  }
}

function privateDirectory(path: string, uid: number): string {
  try {
    mkdirSync(path, { mode: 0o700 })
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
  }
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o777) !== 0o700)
    throw new Error('The TwirChat activation directory must be owned by this user with mode 0700.')
  return path
}

function activationPath(uid: number, key: string): string {
  return join(privateDirectory(`/tmp/twirchat-${uid}`, uid), `${key}.sock`)
}

async function acquireLock(name: string) {
  const lock = createServer((socket) => socket.destroy())
  return new Promise<ReturnType<typeof createServer> | undefined>((resolveLock, reject) => {
    lock.once('error', (error) => {
      if ('code' in error && error.code === 'EADDRINUSE') resolveLock(undefined)
      else reject(error)
    })
    lock.listen(name, () => resolveLock(lock))
  })
}

/** The abstract socket owns the lifetime; only the private pathname socket accepts commands. */
export async function establishLinuxSingleInstance(profilePath: string): Promise<SingleInstance> {
  if (process.platform !== 'linux') return { kind: 'unsupported' }
  if (globalThis.__twirchatLinuxInstance) return globalThis.__twirchatLinuxInstance
  const uid = process.getuid?.()
  if (uid === undefined) throw new Error('Cannot determine the Linux user for activation.')
  const key = createHash('sha256')
    .update(`${uid}:${canonicalPath(resolve(profilePath))}`)
    .digest('hex')
    .slice(0, 32)
  const socketPath = activationPath(uid, key)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const lock = await acquireLock(`\0twirchat-${uid}-${key}`)
    if (lock) {
      try {
        try {
          unlinkSync(socketPath)
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
            throw error
        }
        let activate: (() => boolean) | undefined
        let pending = false
        let stopping = false
        const server = Bun.serve({
          unix: socketPath,
          fetch(request) {
            const url = new URL(request.url)
            if (
              request.method !== 'POST' ||
              url.pathname !== '/activate' ||
              url.search ||
              request.headers.has('transfer-encoding') ||
              Number(request.headers.get('content-length') ?? 0) !== 0
            )
              return new Response(null, { status: 400 })
            if (stopping) return new Response(null, { status: 503 })
            if (activate && !activate()) return new Response(null, { status: 503 })
            if (!activate) pending = true
            return new Response(null, { status: 204 })
          },
        })
        const primary: PrimaryInstance = {
          kind: 'primary',
          bindActivation(callback) {
            if (stopping) return
            activate = callback
            if (pending) {
              pending = false
              callback()
            }
          },
          stopActivation() {
            stopping = true
            activate = undefined
            return server.stop(true)
          },
        }
        globalThis.__twirchatLinuxInstance = primary
        return primary
      } catch (error) {
        lock.close()
        throw error
      }
    }
    try {
      const response = await fetch('http://localhost/activate', {
        unix: socketPath,
        method: 'POST',
        signal: AbortSignal.timeout(300),
      })
      if (response.status === 204) return { kind: 'forwarded' }
    } catch {
      // The owner may still be binding its endpoint, or may have just exited.
    }
    await Bun.sleep(50)
  }
  throw new Error('The running TwirChat instance did not accept activation. Try again shortly.')
}
