import { For, type JSX } from 'solid-js'
import type { Rank, Suit } from './Card'

/**
 * SVG art for the card faces: suit glyphs, pip layout table, court portraits,
 * designed aces, and the crimson lattice back. All art draws in a 100×140 box
 * (poker aspect ~1:1.4) and scales with the card via viewBox.
 *
 * Design language (from dribbble refs): rich saturated color, gold accents,
 * cream faces, bold classic silhouettes.
 */

// ---- suit colors: pastel-but-legible; corners use ink-darkened AA variants ----
export const SUIT_COLOR: Record<Suit, string> = {
  s: '#2b2b2b',
  h: '#e05252',
  d: '#5a8fd6',
  c: '#4f9e63',
}
// AA-on-cream (#fdf9f0) versions for corner indices. Contrast: 13.9 / 5.4 / 5.9 / 5.6 :1
export const SUIT_INK: Record<Suit, string> = {
  s: '#2b2b2b',
  h: '#b03535',
  d: '#33629e',
  c: '#35764a',
}

export const GOLD = '#d9a441'
export const GOLD_DARK = '#8a6a1f'
export const CREAM = '#fdf9f0'

/** single suit glyph centered in a 0..100 × 0..100 box; fill inherited.
 *  Classic full silhouettes — ink spans ~72-84% width, ~84-92% height. */
export function SuitPath(props: { suit: Suit }): JSX.Element {
  switch (props.suit) {
    case 's':
      return (
        <g>
          <path d="M50 2C44 14 16 28 16 54c0 14 10 24 22 24 4 0 8-1.5 12-4 4 2.5 8 4 12 4 12 0 22-10 22-24C84 28 56 14 50 2Z" />
          <path d="M46 60c1 14-4 24-12 30h32c-8-6-13-16-12-30-2.7 2-5.3 2-8 0Z" />
        </g>
      )
    case 'h':
      return <path d="M50 96C28 78 8 62 8 40 8 24 19 12 34 12c7 0 13 3.5 16 9 3-5.5 9-9 16-9 15 0 26 12 26 28 0 22-20 38-42 56Z" />
    case 'd':
      return <path d="M50 4 86 50 50 96 14 50Z" />
    case 'c':
      return (
        <g>
          <circle cx="50" cy="25" r="19" />
          <circle cx="27" cy="53" r="19" />
          <circle cx="73" cy="53" r="19" />
          <path d="M45 50c1 16-4 26-12 32h34c-8-6-13-16-12-32-3.3 2.6-6.7 2.6-10 0Z" />
        </g>
      )
  }
}

const RANK_LABEL: Record<Rank, string> = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  '10': '10', J: 'J', Q: 'Q', K: 'K', A: 'A',
}

/**
 * Corner index: bold rank + small suit glyph beneath, drawn centered on x=0
 * from y=0 (caller translates to the corner; BR corner rotates 180°).
 * Stroke + paint-order fattens small-size text (hairline system fonts).
 * Block spans y 10..40, x 2..20 — clears pip columns (ink from x 21.7).
 */
export function CornerIndex(props: { rank: Rank; suit: Suit; ink: string }): JSX.Element {
  const ten = props.rank === '10'
  return (
    <g text-anchor="middle" fill={props.ink}>
      <text
        y="17"
        font-size={ten ? '17' : '28'}
        font-weight="800"
        letter-spacing={ten ? '-1.5' : '-0.5'}
        stroke={props.ink}
        stroke-width="0.9"
        paint-order="stroke"
        style="font-family: var(--font-display), ui-sans-serif, system-ui, sans-serif"
      >
        {RANK_LABEL[props.rank]}
      </text>
      <g transform="translate(0 27) scale(0.17) translate(-50 -50)">
        <SuitPath suit={props.suit} />
      </g>
    </g>
  )
}

// ---- pip layout: traditional French decks ----
// Card 100×140. Corner blocks y 1..40 at x 0..20 (mirrored bottom-right).
// Pip columns x=30/70 (ink 21.7..38.3 / 61.7..78.3 at scale 0.23), center x=50.
// Row stations y: 22, 54, 70(mid), 86, 118; center extras 38, 102.
// Glyph ink ≤21.2u tall vs ≥27u row gap on 4-row ranks — no overlap.
type Pip = { x: number; y: number; flip?: boolean }

const L = 30, R = 70, M = 50
const T = 22, B = 118
const U = 54, D = 86
const MID = 70

export const PIP_TABLE: Record<Exclude<Rank, 'J' | 'Q' | 'K' | 'A'>, Pip[]> = {
  '2':  [{ x: M, y: T }, { x: M, y: B, flip: true }],
  '3':  [{ x: M, y: T }, { x: M, y: MID }, { x: M, y: B, flip: true }],
  '4':  [{ x: L, y: T }, { x: R, y: T }, { x: L, y: B, flip: true }, { x: R, y: B, flip: true }],
  '5':  [{ x: L, y: T }, { x: R, y: T }, { x: M, y: MID }, { x: L, y: B, flip: true }, { x: R, y: B, flip: true }],
  '6':  [{ x: L, y: T }, { x: R, y: T }, { x: L, y: MID }, { x: R, y: MID, flip: true }, { x: L, y: B, flip: true }, { x: R, y: B, flip: true }],
  '7':  [{ x: L, y: T }, { x: R, y: T }, { x: M, y: 38 }, { x: L, y: MID }, { x: R, y: MID, flip: true }, { x: L, y: B, flip: true }, { x: R, y: B, flip: true }],
  '8':  [{ x: L, y: T }, { x: R, y: T }, { x: M, y: 38 }, { x: L, y: MID }, { x: R, y: MID, flip: true }, { x: M, y: 102, flip: true }, { x: L, y: B, flip: true }, { x: R, y: B, flip: true }],
  '9':  [{ x: L, y: T }, { x: R, y: T }, { x: L, y: U }, { x: R, y: U }, { x: M, y: MID }, { x: L, y: D, flip: true }, { x: R, y: D, flip: true }, { x: L, y: B, flip: true }, { x: R, y: B, flip: true }],
  '10': [{ x: L, y: T }, { x: R, y: T }, { x: M, y: 38 }, { x: L, y: U }, { x: R, y: U }, { x: L, y: D, flip: true }, { x: R, y: D, flip: true }, { x: M, y: 102, flip: true }, { x: L, y: B, flip: true }, { x: R, y: B, flip: true }],
}

/** Pip field for 2–10. Bottom-half pips render rotated 180° (traditional). */
export function Pips(props: { rank: Exclude<Rank, 'J' | 'Q' | 'K' | 'A'>; suit: Suit; color: string }): JSX.Element {
  return (
    <g fill={props.color}>
      <For each={PIP_TABLE[props.rank]}>
        {(p) => (
          <g transform={`translate(${p.x} ${p.y})${p.flip ? ' rotate(180)' : ''} scale(0.23) translate(-50 -50)`}>
            <SuitPath suit={props.suit} />
          </g>
        )}
      </For>
    </g>
  )
}

// ---- court portraits: animal busts in arched panels ----
// Classical court structure: framed arch panel, big readable head, gold
// crown/tiara/cap, suit-colored garment, ink details. Main fills use SUIT_INK
// (rich, saturated) — pastel + gold as accents.

/** Arched panel behind every court portrait */
function Panel(props: { suit: Suit; color: string }): JSX.Element {
  return (
    <path
      d="M28 110V56c0-13 10-24 22-24s22 11 22 24v54Z"
      fill={props.color}
      fill-opacity="0.08"
      stroke={props.color}
      stroke-width="0.8"
      stroke-opacity="0.4"
    />
  )
}

/** King — bear with crown */
function CourtBear(props: { suit: Suit; color: string }): JSX.Element {
  const ink = props.color
  return (
    <g>
      <Panel suit={props.suit} color={ink} />
      {/* shoulders */}
      <path d="M31 110v-8c0-11 8.5-17 19-17s19 6 19 17v8Z" fill={ink} />
      {/* gold collar */}
      <path d="M33 96h34l-2 6H35Z" fill={GOLD} stroke={GOLD_DARK} stroke-width="0.6" />
      <circle cx="42" cy="99" r="1.1" fill={CREAM} />
      <circle cx="50" cy="99" r="1.3" fill={CREAM} />
      <circle cx="58" cy="99" r="1.1" fill={CREAM} />
      {/* ears */}
      <circle cx="35" cy="52" r="7" fill={ink} />
      <circle cx="65" cy="52" r="7" fill={ink} />
      <circle cx="35" cy="52" r="3" fill={CREAM} />
      <circle cx="65" cy="52" r="3" fill={CREAM} />
      {/* head */}
      <circle cx="50" cy="65" r="19" fill={ink} />
      {/* muzzle */}
      <ellipse cx="50" cy="72" rx="9.5" ry="7" fill={CREAM} />
      <ellipse cx="50" cy="68.5" rx="3" ry="2.4" fill="#1c1c1c" />
      <path d="M50 71v3M50 74l-2.6 2M50 74l2.6 2" stroke="#1c1c1c" stroke-width="1.1" fill="none" stroke-linecap="round" />
      {/* eyes */}
      <circle cx="43" cy="61" r="2.2" fill="#1c1c1c" />
      <circle cx="57" cy="61" r="2.2" fill="#1c1c1c" />
      <circle cx="43.7" cy="60.3" r="0.7" fill="#fff" />
      <circle cx="57.7" cy="60.3" r="0.7" fill="#fff" />
      {/* crown */}
      <path d="M40 44v-8l5.5 4L50 32l4.5 8L60 36v8Z" fill={GOLD} stroke={GOLD_DARK} stroke-width="0.7" />
      <circle cx="50" cy="30.5" r="1.6" fill={GOLD} stroke={GOLD_DARK} stroke-width="0.6" />
      <circle cx="45" cy="40" r="1" fill={CREAM} />
      <circle cx="55" cy="40" r="1" fill={CREAM} />
    </g>
  )
}

/** Queen — turtle with tiara */
function CourtTurtle(props: { suit: Suit; color: string }): JSX.Element {
  const ink = props.color
  return (
    <g>
      <Panel suit={props.suit} color={ink} />
      {/* shell dome */}
      <path d="M30 110v-6c0-13 9-21 20-21s20 8 20 21v6Z" fill={ink} />
      {/* shell scallops */}
      <path d="M36 102q4-7 7 0M43 102q4-7 7 0M50 102q4-7 7 0M57 102q4-7 7 0" stroke={CREAM} stroke-width="1.1" fill="none" stroke-linecap="round" opacity="0.85" />
      {/* shell rim */}
      <path d="M30 104h40" stroke={GOLD} stroke-width="1.6" />
      <circle cx="36" cy="104" r="1" fill={GOLD} />
      <circle cx="50" cy="104" r="1" fill={GOLD} />
      <circle cx="64" cy="104" r="1" fill={GOLD} />
      {/* head */}
      <circle cx="50" cy="66" r="15" fill={ink} />
      {/* tiara */}
      <path d="M43 54l2.5-7 4.5 5 4.5-5 2.5 7Z" fill={GOLD} stroke={GOLD_DARK} stroke-width="0.6" />
      <circle cx="50" cy="44.5" r="1.4" fill={GOLD} stroke={GOLD_DARK} stroke-width="0.5" />
      {/* face */}
      <circle cx="44.5" cy="64" r="2" fill="#1c1c1c" />
      <circle cx="55.5" cy="64" r="2" fill="#1c1c1c" />
      <circle cx="45.2" cy="63.3" r="0.65" fill="#fff" />
      <circle cx="56.2" cy="63.3" r="0.65" fill="#fff" />
      <path d="M47 70q3 2.4 6 0" stroke="#1c1c1c" stroke-width="1.1" fill="none" stroke-linecap="round" />
      <circle cx="42.5" cy="68" r="1.8" fill={GOLD} opacity="0.4" />
      <circle cx="57.5" cy="68" r="1.8" fill={GOLD} opacity="0.4" />
      {/* necklace */}
      <circle cx="45" cy="83" r="1.2" fill={CREAM} />
      <circle cx="50" cy="84.5" r="1.2" fill={CREAM} />
      <circle cx="55" cy="83" r="1.2" fill={CREAM} />
    </g>
  )
}

/** Jack — hawk with cap */
function CourtHawk(props: { suit: Suit; color: string }): JSX.Element {
  const ink = props.color
  return (
    <g>
      <Panel suit={props.suit} color={ink} />
      {/* shoulders + chest */}
      <path d="M31 110v-8c0-11 8.5-16 19-16s19 5 19 16v8Z" fill={ink} />
      <ellipse cx="50" cy="104" rx="10" ry="7.5" fill={CREAM} />
      <path d="M45 101q2.5 2 5 0M50 101q2.5 2 5 0M45 105q2.5 2 5 0M50 105q2.5 2 5 0" stroke="#00000030" stroke-width="0.8" fill="none" stroke-linecap="round" />
      {/* head */}
      <circle cx="50" cy="64" r="16" fill={ink} />
      {/* fierce brow + eyes */}
      <path d="M40 58l8 2.5M60 58l-8 2.5" stroke="#1c1c1c" stroke-width="1.6" stroke-linecap="round" />
      <circle cx="44" cy="64" r="2.8" fill={CREAM} />
      <circle cx="56" cy="64" r="2.8" fill={CREAM} />
      <circle cx="44.6" cy="64.4" r="1.5" fill="#1c1c1c" />
      <circle cx="56.6" cy="64.4" r="1.5" fill="#1c1c1c" />
      <circle cx="45.1" cy="63.8" r="0.5" fill="#fff" />
      <circle cx="57.1" cy="63.8" r="0.5" fill="#fff" />
      {/* hooked beak */}
      <path d="M50 66l7 4.5c-.5 4-3.5 6-7 5.5 1.8-2.5 2-6 0-10Z" fill={GOLD} stroke={GOLD_DARK} stroke-width="0.6" />
      {/* tilted cap */}
      <path d="M35 55c1-7 7-11 15-11s14 4 15 11l.5 2.5h-31Z" fill={GOLD} stroke={GOLD_DARK} stroke-width="0.7" />
      <path d="M34.5 57.5h31c.8 1.6-.5 3-2.5 3h-26c-2 0-3.3-1.4-2.5-3Z" fill={GOLD_DARK} />
      <circle cx="50" cy="43" r="1.8" fill={CREAM} stroke={GOLD_DARK} stroke-width="0.5" />
      {/* feather */}
      <path d="M63 46c5-6 10-8 14-7-1 5-4 9-9 11Z" fill={ink} opacity="0.9" />
    </g>
  )
}

export function Court(props: { rank: 'J' | 'Q' | 'K'; suit: Suit; color: string }): JSX.Element {
  switch (props.rank) {
    case 'K': return <CourtBear suit={props.suit} color={props.color} />
    case 'Q': return <CourtTurtle suit={props.suit} color={props.color} />
    case 'J': return <CourtHawk suit={props.suit} color={props.color} />
  }
}

/** Designed ace: one big classic glyph — the negative space is the design. */
export function AceDesign(props: { suit: Suit; color: string }): JSX.Element {
  return (
    <g fill={props.color}>
      <g transform="translate(50 70) scale(0.68) translate(-50 -50)">
        <SuitPath suit={props.suit} />
      </g>
    </g>
  )
}

/** Crimson back: gold lattice, cream double frame, center medallion. */
export function BackArt(): JSX.Element {
  return (
    <svg class="absolute inset-0 h-full w-full" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <pattern id="crimson-lattice" width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="#a8103f" />
          <path d="M0 6h12M6 0v12" stroke="#c99a3f" stroke-width="1" stroke-opacity="0.55" />
          <circle cx="6" cy="6" r="1.1" fill="#e4b454" fill-opacity="0.8" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="100" height="140" fill="#a8103f" />
      <rect x="5" y="5" width="90" height="130" rx="6" fill="url(#crimson-lattice)" />
      <rect x="3.5" y="3.5" width="93" height="133" rx="7" fill="none" stroke="#f2e6cf" stroke-width="1.3" />
      <rect x="6.5" y="6.5" width="87" height="127" rx="5" fill="none" stroke="#f2e6cf" stroke-width="0.5" stroke-opacity="0.55" />
      {/* center medallion */}
      <circle cx="50" cy="70" r="11" fill="#a8103f" stroke="#e4b454" stroke-width="1.2" />
      <circle cx="50" cy="70" r="8.5" fill="none" stroke="#f2e6cf" stroke-width="0.6" stroke-opacity="0.7" />
      <path d="M50 63.5 55 70l-5 6.5L45 70Z" fill="#e4b454" />
    </svg>
  )
}
