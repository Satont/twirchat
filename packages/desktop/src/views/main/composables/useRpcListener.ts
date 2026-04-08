import { onUnmounted } from 'vue'

import { rpc } from '../main'
import type { TwirChatRPCSchema } from '../../../shared/rpc'

type WebviewMessages = TwirChatRPCSchema['webview']['messages']

export function useRpcListener<K extends keyof WebviewMessages>(
  event: K,
  handler: (payload: WebviewMessages[K]) => void,
): void {
  rpc.addMessageListener(event, handler)

  onUnmounted(() => {
    rpc.removeMessageListener(event, handler)
  })
}
