/**
 * SSE Event Bus for Deno Desktop
 *
 * Deno bindings are request/response only — no push mechanism.
 * This module provides SSE (Server-Sent Events) to push messages
 * from the Deno main process to the webview.
 */

const encoder = new TextEncoder()

const subscribers = new Set<ReadableStreamDefaultController>()

export function pushEvent(type: string, data: unknown): void {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
  const encoded = encoder.encode(msg)
  for (const ctrl of subscribers) {
    try {
      ctrl.enqueue(encoded)
    } catch {
      subscribers.delete(ctrl)
    }
  }
}

export function createSseStream(): Response {
  const stream = new ReadableStream({
    start(controller) {
      subscribers.add(controller)
      // Send initial heartbeat
      controller.enqueue(encoder.encode(': heartbeat\n\n'))
    },
    cancel(controller) {
      subscribers.delete(controller)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

export function getSubscriberCount(): number {
  return subscribers.size
}
