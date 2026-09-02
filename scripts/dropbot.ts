/**
 * Headless Texas Drop bot: joins dev-table, arms a Texas Drop game, then
 * plays stay/drop randomly each round (and check/calls any regular hands
 * between drop games).
 *
 *   bun scripts/dropbot.ts <name> [seat]
 */
const API = process.env.API_URL ?? "http://localhost:8091";
const TABLE = process.env.TABLE_ID ?? "dev-table";

const [name = `dropbot`, seatArg] = process.argv.slice(2);
const seat = seatArg != null ? Number(seatArg) : null;

const guest = await fetch(`${API}/api/auth/guest`, { method: "POST" }).then((r) => r.json());
const token: string = guest.token;

let ws: WebSocket;
let joined = false;
let decidedThisRound = false;
let armed = false;
const send = (m: unknown) => ws.send(JSON.stringify(m));
const log = (...a: unknown[]) => console.log(`[${name}]`, ...a);

function connect() {
  ws = new WebSocket(
    `${API.replace(/^http/, "ws")}/api/tables/${TABLE}/ws?token=${encodeURIComponent(token)}`,
  );
  ws.onopen = () => {
    log("connected");
    send({ type: "join", ...(seat != null ? { seat } : {}), name, stack: 4000 });
  };
  ws.onmessage = onMessage;
  ws.onclose = () => {
    log("closed — reconnecting");
    joined = false;
    decidedThisRound = false;
    armed = false;
    setTimeout(connect, 1000);
  };
}

function onMessage(e: MessageEvent) {
  const m = JSON.parse(e.data as string);
  if (m.type === "seats" && !joined) {
    joined = true;
    log("seated");
    setTimeout(() => {
      if (!armed) {
        armed = true;
        log("arming TEXAS DROP");
        send({ type: "texas_drop" });
      }
    }, 500);
  }
  if (m.type === "event" && m.event) {
    const ev = m.event;
    if (ev.type === "hand_started" || ev.type === "drop_reveal") decidedThisRound = false;
    if (ev.type === "drop_decide" && !decidedThisRound && joined) {
      decidedThisRound = true;
      const stay = Math.random() < 0.65;
      log(`round ${ev.round}: choosing ${stay ? "STAY" : "DROP"}`);
      setTimeout(() => send({ type: "action", kind: stay ? "stay" : "drop" }), 600 + Math.random() * 900);
    }
    if (ev.type === "pot_awarded") log("pot_awarded:", JSON.stringify(ev.winners));
    if (ev.type === "drop_replenish") log("replenish:", ev.player, ev.amount);
    if (ev.type === "hand_ended") log("game over — stacks:", JSON.stringify(ev.stacks));
  }
  if (m.type === "post_hand") {
    // 7-2 bounty: muck (no reveal). Rabbit prompt (if it follows): skip.
    setTimeout(() => send({ type: "rabbit", reveal: false }), 300);
  }
  if (m.type === "action_required" && m.legal?.seat != null) {
    const la = m.legal;
    setTimeout(() => {
      if (la.can_check) return send({ type: "action", kind: "check" });
      if (la.can_call && la.call_amount <= 200) return send({ type: "action", kind: "call" });
      return send({ type: "action", kind: "fold" });
    }, 400 + Math.random() * 500);
  }
  if (m.type === "error") log("error:", m.error);
}

connect();
