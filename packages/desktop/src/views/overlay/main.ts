import { createApp } from 'vue'
import App from './App.vue'

// The overlay is a standalone page served by overlay-server.ts via Bun.serve.
// It connects to the WS server at ws://localhost:45823 to receive messages.
// No Electrobun RPC needed here.

createApp(App).mount('#app')
