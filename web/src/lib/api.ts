import type { TableConfig, TableSummary } from './types'
import { authIdentity } from './identity'

/**
 * Typed fetch wrappers. Mock mode: when VITE_API_URL is unset, return fake tables
 * so the lobby renders without a backend.
 */
const API_URL = import.meta.env.VITE_API_URL
export const MOCK_MODE = !API_URL

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const id = await authIdentity()
  const sep = path.includes('?') ? '&' : '?'
  const auth = id ? `${sep}token=${encodeURIComponent(id.token)}` : ''
  const res = await fetch(`${API_URL}${path}${auth}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`)
  return res.json() as Promise<T>
}

// --- mock data ---

let mockTables: TableSummary[] = [
  { id: 't1', name: 'Felt & Gold', gameType: 'NLHE', smallBlindCents: 10, bigBlindCents: 20, seatsFilled: 6, maxSeats: 9, avgPotCents: 1850 },
  { id: 't2', name: 'Quad Alley', gameType: 'PLO4', smallBlindCents: 25, bigBlindCents: 50, seatsFilled: 4, maxSeats: 6, avgPotCents: 6120 },
  { id: 't3', name: 'River Rats', gameType: 'NLHE', smallBlindCents: 5, bigBlindCents: 10, seatsFilled: 9, maxSeats: 9, avgPotCents: 720 },
  { id: 't4', name: 'Bomb Garden', gameType: 'NLHE', smallBlindCents: 50, bigBlindCents: 100, seatsFilled: 2, maxSeats: 9, avgPotCents: 15400 },
]

export function listTables(): Promise<TableSummary[]> {
  if (MOCK_MODE) return Promise.resolve([...mockTables])
  return req<TableSummary[]>('/tables')
}

export function createTable(config: TableConfig): Promise<TableSummary> {
  if (MOCK_MODE) {
    const t: TableSummary = {
      id: `mock-${Date.now()}`,
      name: config.name || 'New Table',
      gameType: config.gameType,
      smallBlindCents: config.smallBlindCents,
      bigBlindCents: config.bigBlindCents,
      seatsFilled: 0,
      maxSeats: 9,
    }
    mockTables = [...mockTables, t]
    return Promise.resolve(t)
  }
  return req<TableSummary>('/tables', { method: 'POST', body: JSON.stringify(config) })
}

/** ponytail: join is a stub until the table view route exists; wire to WS seat-take later. */
export function joinTable(id: string): Promise<{ ok: true }> {
  if (MOCK_MODE) return Promise.resolve({ ok: true })
  return req<{ ok: true }>(`/tables/${id}/join`, { method: 'POST' })
}
