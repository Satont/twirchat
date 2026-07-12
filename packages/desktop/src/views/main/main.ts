import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { rpc } from './services/desktop-api'

export { rpc }

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
