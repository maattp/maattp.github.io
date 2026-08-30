// Ring relay room — a single Durable Object instance (idFromName("ring")).
//
// One end is the Mac mini's coordinator session, which holds an outbound
// WebSocket to this DO (the mini has no public address, so it dials out).
// The other end is POST /send, called by the /ring/mcp relay when Pebble's
// agent invokes send_to_coordinator.
//
// Deliberately dumb: no state machine, no history. If the socket is up the
// text goes down it and the caller is told "delivered"; if not, the caller is
// told the coordinator is offline. Messages are never queued — a ring request
// that arrives while the mini is down is stale by the time it comes back, and
// silently replaying it later would be worse than dropping it.

const PING_MS = 4 * 60 * 1000; // keep the hibernating socket from idling out

type Attachment = { since: number };

export class RingRoom {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private sockets(): WebSocket[] {
    return this.state.getWebSockets();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      // Only one coordinator should be attached. A reconnect after a dropped
      // socket can race the old one's close, so evict any existing sockets
      // rather than accumulating dead listeners that all "receive" the text.
      for (const ws of this.sockets()) {
        try { ws.close(1012, "replaced"); } catch { /* already gone */ }
      }
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ since: Date.now() } satisfies Attachment);
      await this.state.storage.setAlarm(Date.now() + PING_MS);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // Pre-built payload from the ChatRoom DO — the ONLY inbound producer.
    // Ring presses reach the agent the same way as any chat message: recorded
    // in the dm thread first, then forwarded from there. One path, and a
    // press that arrives while the agent is down survives in the feed for
    // catch-up instead of being dropped.
    if (url.pathname === "/forward" && request.method === "POST") {
      const payload = await request.text();
      const live = this.sockets();
      let delivered = false;
      for (const ws of live) {
        try { ws.send(payload); delivered = true; } catch { /* closing */ }
      }
      return Response.json({ delivered });
    }

    if (url.pathname === "/status") {
      const attached = this.sockets().length;
      return Response.json({ attached, online: attached > 0 });
    }

    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // The mini only ever speaks to keep the socket warm. Nothing it sends is
    // acted on — this path is one-way by design.
    if (typeof message === "string" && message === "ping") ws.send("pong");
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try { ws.close(); } catch { /* already closed */ }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try { ws.close(); } catch { /* already closed */ }
  }

  async alarm(): Promise<void> {
    for (const ws of this.sockets()) {
      try { ws.send(JSON.stringify({ type: "ping", at: Date.now() })); } catch { /* closing */ }
    }
    if (this.sockets().length > 0) {
      await this.state.storage.setAlarm(Date.now() + PING_MS);
    }
  }
}
