import type { NormalizedChatMessage } from '@twirchat/shared/types'

const ENDPOINT = 'http://localhost:45824/dev/inject-chat'
const COUNT = 150

for (let i = 0; i < COUNT; i++) {
  const msg: NormalizedChatMessage = {
    id: `seed-${Date.now()}-${i}`,
    platform: 'twitch',
    channelId: 'test',
    author: {
      id: `user-${i % 10}`,
      username: `testuser${i % 10}`,
      displayName: `TestUser${i % 10}`,
      badges: [],
    },
    text: `Seed message #${i + 1}: Hello from seed-chat fixture`,
    emotes: [],
    timestamp: new Date(),
    type: 'message',
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
  })

  if (!res.ok) {
    console.error(`Failed to inject message ${i}: ${res.status}`)
    process.exit(1)
  }

  await Bun.sleep(20)
}

console.log(`Injected ${COUNT} messages successfully`)
