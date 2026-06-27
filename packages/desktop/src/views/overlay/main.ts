import { createApp } from 'vue'
import App from './App.vue'

// The overlay is a standalone page served by overlay-server.ts via Deno.serve.
// It connects to the WS server at ws://localhost:45823 to receive messages.

createApp(App).mount('#app')
