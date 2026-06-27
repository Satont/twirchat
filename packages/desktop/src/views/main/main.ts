import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'

// Deno bindings are available as a global (declared in ../../bindings.ts)

// ----------------------------------------------------------------
// Set up SSE event stream for push events from the Deno main process
// ----------------------------------------------------------------

const eventSource = new EventSource('/api/events')

export { eventSource }

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
