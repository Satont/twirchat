import { createApp, ref } from 'vue'
import { VList } from 'virtua/vue'
import type { NormalizedChatMessage } from '@twirchat/shared/types'

function makeFakeMessage(i: number): NormalizedChatMessage {
  return {
    id: `test-${i}`,
    platform: 'twitch',
    channelId: 'test-channel',
    author: {
      id: `user-${i}`,
      displayName: `User${i}`,
      badges: [],
    },
    text: `Message #${i}: ${Array(5).fill('Lorem ipsum').join(' ')}`,
    emotes: [],
    timestamp: new Date(),
    type: 'message',
  }
}

const messages = ref<NormalizedChatMessage[]>(
  Array.from({ length: 200 }, (_, i) => makeFakeMessage(i)),
)

createApp({
  setup() {
    return { messages }
  },
  template: `
    <VList :data="messages" :reverse="true" style="height:100vh">
      <template #default="{ item }">
        <div style="padding:4px 8px;border-bottom:1px solid #333;">
          <span style="color:#a78bfa;font-weight:600">{{ item.author.displayName }}:</span>
          {{ item.text }}
        </div>
      </template>
    </VList>
  `,
  components: { VList },
}).mount('#harness')
