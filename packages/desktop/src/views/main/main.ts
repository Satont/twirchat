import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'

// ----------------------------------------------------------------
// Mount Vue app
// ----------------------------------------------------------------

try {
  const app = createApp(App)
  app.use(createPinia())
  app.mount('#app')
} catch (error) {
  console.error('[main.ts] Failed to mount app:', error)
}
