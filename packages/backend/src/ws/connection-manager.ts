import type { BackendToDesktopMessage } from '@twirchat/shared'
import { logger } from '@twirchat/shared/logger'

const log = logger('ws')

export interface WsData {
  clientSecret: string
}

export type ClientSocket = { data: WsData; send(message: string): unknown }

/** Manages active WebSocket connections from desktop clients */
class ConnectionManager {
  private connections = new Map<string, ClientSocket>()

  register(ws: ClientSocket): void {
    this.connections.set(ws.data.clientSecret, ws)
    log.info('Client connected', { client: ws.data.clientSecret.slice(0, 8) })
  }

  isCurrent(ws: ClientSocket): boolean {
    return this.connections.get(ws.data.clientSecret) === ws
  }

  remove(ws: ClientSocket): boolean {
    if (!this.isCurrent(ws)) return false
    this.connections.delete(ws.data.clientSecret)
    log.info('Client disconnected', { client: ws.data.clientSecret.slice(0, 8) })
    return true
  }

  send(clientSecret: string, message: BackendToDesktopMessage): boolean {
    const ws = this.connections.get(clientSecret)
    if (!ws) {
      return false
    }
    ws.send(JSON.stringify(message))
    return true
  }

  broadcast(message: BackendToDesktopMessage): void {
    const payload = JSON.stringify(message)
    for (const ws of this.connections.values()) {
      ws.send(payload)
    }
  }

  has(clientSecret: string): boolean {
    return this.connections.has(clientSecret)
  }

  get size(): number {
    return this.connections.size
  }
}

export const connectionManager = new ConnectionManager()
