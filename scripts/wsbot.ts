/**
 * Headless WS poker bot for local multi-player testing (DEV_AUTH=1).
 * Joins dev-table, plays every hand: mostly check/call, small mix of
 * raises/folds. Runs until killed; reconnects if the server reaps the
 * idle conn (10min read timeout) — the seat is re-adopted by token.
 *
 *   bun scripts/wsbot.ts <name> [seat]
 *   bun scripts/wsbot.ts alice 1
 */
const API = process.env.API_URL ?? "http://localhost:8080";
const TABLE = process.env.TABLE_ID ?? "dev-table";

const [name = `bot${Math.floor(Math.random() * 100)}`, seatArg] = process.argv.slice(2);
const seat = seatArg != null ? Number(seatArg) : null;

const guest = await fetch(`${API}/api/auth/guest`, { method: "POST" }).then((r) => r.json());
const token: string = guest.token;

let ws: WebSocket;
let joined = false;
const send = (m: unknown) => ws.send(JSON.stringify(m));

function connect() {
  ws = new WebSocket(
    `${API.replace(/^http/, "ws")}/api/tables/${TABLE}/ws?token=${encodeURIComponent(token)}`,
  );
  ws.onopen = () => {
    console.log(`[${name}] connected`);
    // claim an empty seat (or the requested one); 100bb at the table's bb
    send({ type: "join", ...(seat != null ? { seat } : {}), name, stack: 4000 });
  };
  ws.onmessage = onMessage;
  ws.onclose = () => {
    console.log(`[${name}] closed — reconnecting`);
    joined = false;
    setTimeout(connect, 1000);
  };
}

function onMessage(e: MessageEvent) {
  const m = JSON.parse(e.data as string);
  if (m.type === "seats" && !joined) {
    joined = true;
    console.log(`[${name}] seated`);
  }
  if (m.type === "action_required" && m.legal.seat != null) {
    const la = m.legal;
    // decide fast; tiny delay so frames don't slam the engine
    setTimeout(() => {
      const roll = Math.random();
      if (la.can_check && roll < 0.6) return send({ type: "action", kind: "check" });
      if (roll < 0.75) return send({ type: "action", kind: la.can_check ? "check" : "call" });
      if (roll < 0.85 && la.can_raise) {
        const to = Math.min(la.max_raise_to, la.min_raise_to * 2);
        return send({ type: "action", kind: "bet", amount: to });
      }
      send({ type: "action", kind: la.can_check ? "check" : "call" });
    }, 400 + Math.random() * 600);
  }
  if (m.type === "error") console.log(`[${name}] error: ${m.error}`);
}

connect();
