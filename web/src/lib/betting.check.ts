/** Self-check: raise preset math + bet parsing. Run: bun src/lib/betting.check.ts */
import { parseBetToCents, raisePresets, raiseStepCents } from './betting'

const assert = (cond: boolean, msg: string) => { if (!cond) { console.error('FAIL:', msg); process.exit(1) } }

// preflop unopened (blinds 0.10/0.20 posted, streetBet=bb)
let p = raisePresets({ street: 'preflop', potCents: 30, streetBetCents: 20, heroBetCents: 10, callCents: 10, sbCents: 10, bbCents: 20, minRaiseToCents: 40, maxRaiseToCents: 5010 })
assert(p.some((x) => x.label === '2.5bb' && x.toCents === 50), `2.5bb→50, got ${JSON.stringify(p)}`)
assert(p.some((x) => x.label === '3.5bb' && x.toCents === 70), '3.5bb→70')
assert(p.at(-1)!.label === 'All-in' && p.at(-1)!.toCents === 5010, 'all-in cap')

// vs raise 60: 3x → 180
p = raisePresets({ street: 'preflop', potCents: 130, streetBetCents: 60, heroBetCents: 20, callCents: 40, sbCents: 10, bbCents: 20, minRaiseToCents: 100, maxRaiseToCents: 5000 })
assert(p.some((x) => x.label === '3x' && x.toCents === 180), `3x→180, got ${JSON.stringify(p)}`)
assert(!p.some((x) => x.label === '2.5bb'), 'no bb presets vs raise')

// postflop 33/50/75/100: pot 100 after call, base = heroBet+call
p = raisePresets({ street: 'flop', potCents: 100, streetBetCents: 0, heroBetCents: 0, callCents: 0, sbCents: 10, bbCents: 20, minRaiseToCents: 20, maxRaiseToCents: 5000 })
assert(p.some((x) => x.label === '33%' && x.toCents === 33), `33%→33, got ${JSON.stringify(p)}`)
assert(p.some((x) => x.label === '100%' && x.toCents === 100), '100%→100')

// facing bet 50 into 100: potAfterCall=200, base=50 → 50% = 50+100=150
p = raisePresets({ street: 'turn', potCents: 100, streetBetCents: 50, heroBetCents: 0, callCents: 50, sbCents: 10, bbCents: 20, minRaiseToCents: 100, maxRaiseToCents: 5000 })
assert(p.some((x) => x.label === '50%' && x.toCents === 125), `50%→125, got ${JSON.stringify(p)}`)
assert(p.some((x) => x.label === '75%' && x.toCents === 163), '75%→163')

// out-of-range presets dropped
p = raisePresets({ street: 'turn', potCents: 100, streetBetCents: 50, heroBetCents: 0, callCents: 50, sbCents: 10, bbCents: 20, minRaiseToCents: 4000, maxRaiseToCents: 5000 })
assert(p.length === 1 && p[0].label === 'All-in', `only all-in survives, got ${JSON.stringify(p)}`)

// steps
assert(raiseStepCents({ street: 'preflop', potCents: 0, streetBetCents: 0, heroBetCents: 0, callCents: 0, sbCents: 10, bbCents: 20, minRaiseToCents: 0, maxRaiseToCents: 1 }) === 20, 'preflop step = bb')
assert(raiseStepCents({ street: 'flop', potCents: 200, streetBetCents: 0, heroBetCents: 0, callCents: 0, sbCents: 10, bbCents: 20, minRaiseToCents: 0, maxRaiseToCents: 1 }) === 20, 'postflop step = 10% pot (min sb)')

// typed input parsing
assert(parseBetToCents('2.50') === 250, '2.50→250')
assert(parseBetToCents('$2.5') === 250, '$2.5→250')
assert(parseBetToCents('250') === 25000, '250→25000')
assert(parseBetToCents('2.505') === null, '3 decimals rejected')
assert(parseBetToCents('abc') === null, 'garbage rejected')
assert(parseBetToCents('') === null, 'empty rejected')

console.log('betting.check: all green')
