import { ClientStore } from '../db/index.ts'

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...headers, 'Content-Type': 'application/json' },
    status,
  })
}

/** Validate X-Client-Secret header and auto-register the client. */
export async function requireClient(req: Request): Promise<{ clientSecret: string } | Response> {
  const secret = req.headers.get('X-Client-Secret')
  if (!secret) {
    return json({ error: 'Missing X-Client-Secret header' }, 401)
  }
  await ClientStore.upsert(secret)
  return { clientSecret: secret }
}
