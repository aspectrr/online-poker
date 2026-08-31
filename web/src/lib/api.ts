import type { TableConfig, TableSummary } from "./types";
import type { HandRow } from "./history";
import { authIdentity } from "./identity";

/**
 * Typed fetch wrappers. Mock mode: when VITE_API_URL is unset, return fake tables
 * so the lobby renders without a backend.
 */
const API_URL = import.meta.env.VITE_API_URL;
export const MOCK_MODE = !API_URL;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const id = await authIdentity();
  const sep = path.includes("?") ? "&" : "?";
  const auth = id ? `${sep}token=${encodeURIComponent(id.token)}` : "";
  const res = await fetch(`${API_URL}${path}${auth}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

// --- mock data ---

let mockTables: TableSummary[] = [
  {
    id: "t1",
    name: "Felt & Gold",
    gameType: "NLHE",
    smallBlindCents: 10,
    bigBlindCents: 20,
    seatsFilled: 6,
    maxSeats: 9,
    avgPotCents: 1850,
  },
  {
    id: "t2",
    name: "Quad Alley",
    gameType: "PLO4",
    smallBlindCents: 25,
    bigBlindCents: 50,
    seatsFilled: 4,
    maxSeats: 6,
    avgPotCents: 6120,
  },
  {
    id: "t3",
    name: "River Rats",
    gameType: "NLHE",
    smallBlindCents: 5,
    bigBlindCents: 10,
    seatsFilled: 9,
    maxSeats: 9,
    avgPotCents: 720,
  },
  {
    id: "t4",
    name: "Bomb Garden",
    gameType: "NLHE",
    smallBlindCents: 50,
    bigBlindCents: 100,
    seatsFilled: 2,
    maxSeats: 9,
    avgPotCents: 15400,
  },
];

export function listTables(): Promise<TableSummary[]> {
  if (MOCK_MODE) return Promise.resolve([...mockTables]);
  return req<unknown[]>("/api/tables").then((rows) =>
    rows.map((r) => rowToSummary(r as Record<string, unknown>)),
  );
}

/** server store.GameTable row (no json tags on the struct → Go field names) */
function rowToSummary(r: Record<string, unknown>): TableSummary {
  const cfg = (r.Config ?? {}) as Record<string, unknown>;
  const blinds = (cfg.blinds_sb_bb as number[] | undefined) ?? [10, 20];
  return {
    id: String(r.ID ?? r.id ?? ""),
    name: String(r.Name ?? r.name ?? "table"),
    gameType: r.GameType === "PLO4" || r.game_type === "PLO4" ? "PLO4" : "NLHE",
    smallBlindCents: blinds[0],
    bigBlindCents: blinds[1],
    seatsFilled: 0,
    maxSeats: Number(cfg.max_seats ?? 9),
  };
}

const rankWire = (rank: string): number | null =>
  rank === "any" ? null : "23456789TJQKA".indexOf(rank) + 2;
const suitWire = (suit: string): number | null => (suit === "any" ? null : "shdc".indexOf(suit));

/** UI config -> server store.TableConfig jsonb (snake_case, ranks 2-14). */
function configToWire(c: TableConfig): Record<string, unknown> {
  return {
    blinds_sb_bb: [c.smallBlindCents, c.bigBlindCents],
    starting_stack_bb: c.startingStackBb,
    action_timeout_s: c.actionTimeoutSec,
    inter_hand_delay_s: c.interHandDelaySec,
    rit: c.runItTwice === "always" ? "always" : "never",
    rabbit_hunt: c.rabbitHunt,
    bomb_pot_mode: c.bombPotMode === "every_hand" ? "manual" : c.bombPotMode,
    bomb_pot_triggers:
      c.bombPotMode === "trigger" &&
      c.bombPotTrigger &&
      (c.bombPotTrigger.rank !== "any" || c.bombPotTrigger.suit !== "any")
        ? [{ rank: rankWire(c.bombPotTrigger.rank), suit: suitWire(c.bombPotTrigger.suit) }].filter(
            (t) => t.rank != null,
          )
        : [],
    seven_deuce: c.sevenTwo,
    seven_deuce_bounty: c.sevenTwoBountyCents,
  };
}

export function createTable(config: TableConfig): Promise<TableSummary> {
  if (MOCK_MODE) {
    const t: TableSummary = {
      id: `mock-${Date.now()}`,
      name: config.name || "New Table",
      gameType: config.gameType,
      smallBlindCents: config.smallBlindCents,
      bigBlindCents: config.bigBlindCents,
      seatsFilled: 0,
      maxSeats: 9,
    };
    mockTables = [...mockTables, t];
    return Promise.resolve(t);
  }
  return req<Record<string, unknown>>("/api/tables", {
    method: "POST",
    body: JSON.stringify({
      name: config.name || "New Table",
      game_type: config.gameType,
      config: configToWire(config),
    }),
  }).then(rowToSummary);
}

/** Hand history, newest first (server store.ListHands). */
export function fetchHands(tableId: string, limit = 50): Promise<HandRow[]> {
  if (MOCK_MODE) return Promise.resolve([]);
  return req<HandRow[]>(`/api/tables/${encodeURIComponent(tableId)}/hands?limit=${limit}`);
}

/** ponytail: join is a stub until the table view route exists; wire to WS seat-take later. */
export function joinTable(id: string): Promise<{ ok: true }> {
  if (MOCK_MODE) return Promise.resolve({ ok: true });
  return req<{ ok: true }>(`/tables/${id}/join`, { method: "POST" });
}
