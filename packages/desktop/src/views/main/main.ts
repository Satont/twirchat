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
  return new Promise((resolve) => {
    function check() {
      const socket = (view as unknown as { bunSocket?: WebSocket }).bunSocket
      if (!socket) {
        // BunSocket not assigned yet — poll in next microtask
        setTimeout(check, 10)
        return
      }
      if (socket.readyState === WebSocket.OPEN) {
        resolve()
        return
      }
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener('open', () => resolve(), { once: true })
        socket.addEventListener('error', () => resolve(), { once: true })
        return
      }
      resolve() // CLOSED / unknown — mount anyway
    }
    check()
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
