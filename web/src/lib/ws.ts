import type { ClientMsg, ServerMsg } from "./protocol";

/**
 * Typed WS client with auto-reconnect (exponential backoff + jitter).
 * Token rides the upgrade URL as ?token= (auth.Middleware reads it) and is
 * re-resolved per attempt via `token` — a token minted while the server was
 * cold must not be retried forever.
 */
export class TableSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private timer: number | null = null;
  private url: string;
  private token: () => Promise<string | null | undefined>;
  private onMsg: (m: ServerMsg) => void;
  private onStatus?: (s: "connecting" | "open" | "closed") => void;

  constructor(
    url: string, // wss://…/api/tables/{id}/ws
    token: string | (() => Promise<string | null | undefined>),
    onMsg: (m: ServerMsg) => void,
    onStatus?: (s: "connecting" | "open" | "closed") => void,
  ) {
    this.url = url;
    this.token = typeof token === "string" ? () => Promise.resolve(token) : token;
    this.onMsg = onMsg;
    this.onStatus = onStatus;
  }

  async connect() {
    if (this.closed) return;
    this.onStatus?.("connecting");
    const tok = (await this.token()) ?? "";
    const sep = this.url.includes("?") ? "&" : "?";
    const url = `${this.url}${sep}token=${encodeURIComponent(tok)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.onStatus?.("open");
    };
    ws.onmessage = (e) => {
      try {
        this.onMsg(JSON.parse(e.data) as ServerMsg);
      } catch (err) {
        // malformed frame: server never sends these; log and drop
        console.error("ws frame error", err, e.data);
      }
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.onStatus?.("closed");
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    const delay = Math.min(30000, 500 * 2 ** this.attempt) + Math.random() * 250;
    this.attempt++;
    this.timer = window.setTimeout(() => void this.connect(), delay);
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(m));
    }
  }

  close() {
    this.closed = true;
    if (this.timer) window.clearTimeout(this.timer);
    this.ws?.close();
  }
}

/** Build the WS URL for a table from the API base (VITE_API_URL). */
export function tableWsUrl(apiBase: string, tableId: string, apiKey?: string): string {
  const base = apiBase.replace(/^http/, "ws") + `/api/tables/${tableId}/ws`;
  return apiKey ? `${base}?key=${encodeURIComponent(apiKey)}` : base;
}

/** Build the lobby feed WS URL (public, no token). */
export function lobbyWsUrl(apiBase: string, apiKey?: string): string {
  const base = apiBase.replace(/^http/, "ws") + "/api/lobby/ws";
  return apiKey ? `${base}?key=${encodeURIComponent(apiKey)}` : base;
}
