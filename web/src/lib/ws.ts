import type { ClientMsg, ServerMsg } from './protocol'

/**
 * Typed WS client with auto-reconnect (exponential backoff + jitter).
 * Token rides the upgrade URL as ?token= (auth.Middleware reads it).
 */
export class TableSocket {
  private ws: WebSocket | null = null
  private closed = false
  private attempt = 0
  private timer: number | null = null
  private url: string
  private token: string
  private onMsg: (m: ServerMsg) => void
  private onStatus?: (s: 'connecting' | 'open' | 'closed') => void

  constructor(
    url: string, // wss://…/api/tables/{id}/ws
    token: string,
    onMsg: (m: ServerMsg) => void,
    onStatus?: (s: 'connecting' | 'open' | 'closed') => void,
  ) {
    this.url = url
    this.token = token
    this.onMsg = onMsg
    this.onStatus = onStatus
  }

  connect() {
    if (this.closed) return
    this.onStatus?.('connecting')
    const url = `${this.url}?token=${encodeURIComponent(this.token)}`
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onopen = () => {
      this.attempt = 0
      this.onStatus?.('open')
    }
    ws.onmessage = (e) => {
      try {
        this.onMsg(JSON.parse(e.data) as ServerMsg)
      } catch {
        // malformed frame: server never sends these; drop
      }
    }
    ws.onclose = () => {
      if (this.closed) return
      this.onStatus?.('closed')
      this.scheduleReconnect()
    }
    ws.onerror = () => ws.close()
  }

  private scheduleReconnect() {
    const delay = Math.min(30000, 500 * 2 ** this.attempt) + Math.random() * 250
    this.attempt++
    this.timer = window.setTimeout(() => this.connect(), delay)
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(m))
    }
  }

  close() {
    this.closed = true
    if (this.timer) window.clearTimeout(this.timer)
    this.ws?.close()
  }
}

/** Build the WS URL for a table from the API base (VITE_API_URL). */
export function tableWsUrl(apiBase: string, tableId: string): string {
  return apiBase.replace(/^http/, 'ws') + `/api/tables/${tableId}/ws`
}
