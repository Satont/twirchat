import { expect, test } from 'bun:test'
import { createModerationRoutes } from '../src/routes/moderation.ts'

test('moderation endpoints reject requests that do not identify a desktop client', async () => {
  const routes = createModerationRoutes({
    async execute() {
      return { success: true }
    },
    async getCapabilities() {
      return { canModerate: true }
    },
  })

  const response = await routes['/api/moderation/action'].POST(
    new Request('http://localhost/api/moderation/action', {
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }),
  )

  expect(response.status).toBe(401)
  await expect(response.json()).resolves.toEqual({ error: 'Missing X-Client-Secret header' })
})
