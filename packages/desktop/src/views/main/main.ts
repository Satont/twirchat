import { Electroview } from 'electrobun/view'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import type { TwirChatRPCSchema } from '../../shared/rpc'

// ----------------------------------------------------------------
// Set up Electrobun RPC on the webview side
// ----------------------------------------------------------------

const baseRpc = Electroview.defineRPC<TwirChatRPCSchema>({
  handlers: {
    messages: {},
    requests: {},
  },
  maxRequestTime: 10_000,
})

type RpcRequests = NonNullable<typeof baseRpc.request>
type RequiredRpcRequests = {
  [K in keyof RpcRequests]-?: Exclude<RpcRequests[K], undefined>
}

export const rpc = baseRpc as typeof baseRpc & { request: RequiredRpcRequests }

const view = new Electroview({ rpc })

// ----------------------------------------------------------------
// Wait for the RPC WebSocket to open before mounting Vue,
// So rpc.request.* calls in onMounted don't race against the socket.
// ----------------------------------------------------------------

function waitForSocket(): Promise<void> {
  const socket = (view as unknown as { bunSocket?: WebSocket }).bunSocket

  // Electrobun creates the socket synchronously in the constructor,
  // so this should only happen if internals change.
  if (!socket) {
    console.warn('[main.ts] bunSocket not available — mounting anyway')
    return Promise.resolve()
  }

  // Already open or already failed — no need to wait.
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve()
  }

  // Socket is still CONNECTING — wait for one of the terminal events.
  return new Promise((resolve) => {
    const cleanup = () => {
      socket.removeEventListener('open', onDone)
      socket.removeEventListener('error', onDone)
      socket.removeEventListener('close', onDone)
      window.removeEventListener('pagehide', onDone)
    }

    const onDone = () => {
      cleanup()
      resolve()
    }

    socket.addEventListener('open', onDone, { once: true })
    socket.addEventListener('error', onDone, { once: true })
    socket.addEventListener('close', onDone, { once: true })
    window.addEventListener('pagehide', onDone, { once: true })
  })
}

console.log('[main.ts] Waiting for socket...')
await waitForSocket()
console.log('[main.ts] Socket ready, creating app...')

// ----------------------------------------------------------------
// Mount Vue app
// ----------------------------------------------------------------

try {
  const app = createApp(App)
  app.use(createPinia())
  console.log('[main.ts] App created, mounting...')
  app.mount('#app')
  console.log('[main.ts] App mounted successfully')
} catch (error) {
  console.error('[main.ts] Failed to mount app:', error)
}
