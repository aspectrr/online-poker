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
      {/* cream chest patch */}
      <ellipse cx="50" cy="107.5" rx="8" ry="5" fill={CREAM} />
      {/* ears */}
      <circle cx="35.5" cy="50" r="7" fill={ink} />
      <circle cx="64.5" cy="50" r="7" fill={ink} />
      <circle cx="35.5" cy="50" r="3.2" fill={CREAM} />
      <circle cx="64.5" cy="50" r="3.2" fill={CREAM} />
      {/* head */}
      <circle cx="50" cy="64" r="18" fill={ink} />
      {/* muzzle */}
      <ellipse cx="50" cy="71.5" rx="10" ry="7.5" fill={CREAM} />
      <ellipse cx="50" cy="68" rx="3.1" ry="2.5" fill="#1c1c1c" />
      <path d="M50 70.5v3M50 73.5l-2.6 2M50 73.5l2.6 2" stroke="#1c1c1c" stroke-width="1.1" fill="none" stroke-linecap="round" />
      {/* eyes — white sclera so they survive dark fills */}
      <circle cx="42.5" cy="60" r="2.6" fill={CREAM} />
      <circle cx="57.5" cy="60" r="2.6" fill={CREAM} />
      <circle cx="42.9" cy="60.4" r="1.3" fill="#1c1c1c" />
      <circle cx="57.9" cy="60.4" r="1.3" fill="#1c1c1c" />
      {/* crown */}
      <path d="M40 44v-8l5.5 4L50 32l4.5 8L60 36v8Z" fill={GOLD} stroke={GOLD_DARK} stroke-width="0.7" />
      <circle cx="50" cy="30.5" r="1.6" fill={GOLD} stroke={GOLD_DARK} stroke-width="0.6" />
      <circle cx="45" cy="40" r="1" fill={CREAM} />
      <circle cx="55" cy="40" r="1" fill={CREAM} />
    </g>
  )
}

/** Queen — turtle with tiara: wide patterned shell, side flippers, small head */
function CourtTurtle(props: { suit: Suit; color: string }): JSX.Element {
  const ink = props.color
  return (
    <g>
      <Panel suit={props.suit} color={ink} />
      {/* head — pokes above the shell */}
      <circle cx="50" cy="55" r="10.5" fill={ink} />
      <circle cx="46" cy="54" r="1.7" fill="#1c1c1c" />
      <circle cx="54" cy="54" r="1.7" fill="#1c1c1c" />
      <circle cx="46.6" cy="53.4" r="0.55" fill="#fff" />
      <circle cx="54.6" cy="53.4" r="0.55" fill="#fff" />
      <path d="M47.5 59q2.5 2 5 0" stroke="#1c1c1c" stroke-width="1" fill="none" stroke-linecap="round" />
      <circle cx="43.5" cy="57" r="1.5" fill={GOLD} opacity="0.45" />
      <circle cx="56.5" cy="57" r="1.5" fill={GOLD} opacity="0.45" />
      {/* tiara — 3 points + pearls, clearly a crown */}
      <path d="M43.5 47.5l1.5-6 3.5 3.5L50 38l1.5 7 3.5-3.5 1.5 6Z" fill={GOLD} stroke={GOLD_DARK} stroke-width="0.6" />
      <circle cx="50" cy="36.5" r="1.3" fill={GOLD} stroke={GOLD_DARK} stroke-width="0.5" />
      {/* shell — wide half-dome */}
      <path d="M24 104c0-14 11.5-24 26-24s26 10 26 24l-1.5 6h-49Z" fill={ink} />
      {/* shell plates */}
      <path d="M50 80l9 6-3.5 9h-11L41 86Z M36 84l7 5-3 8h-9l-2.5-6Z M64 84l-7 5 3 8h9l2.5-6Z" fill={CREAM} opacity="0.9" />
      {/* cream belly band */}
      <path d="M25.5 104h49l-1 4c-8 3-17 4.5-23.5 4.5S34.5 111 26.5 108Z" fill={CREAM} />
      <path d="M25.5 104h49l-1 4c-8 3-17 4.5-23.5 4.5S34.5 111 26.5 108Z" fill="none" stroke={GOLD} stroke-width="1" />
      {/* flippers */}
      <path d="M26 92c-4 2-6 6-5 10l7-2c-1.5-2.5-2-5-2-8Z" fill={ink} />
      <path d="M74 92c4 2 6 6 5 10l-7-2c1.5-2.5 2-5 2-8Z" fill={ink} />
    </g>
  )
}

/** Jack — hawk with cap: beanie hugging the head, hooked beak, raptor face */
function CourtHawk(props: { suit: Suit; color: string }): JSX.Element {
  const ink = props.color
  return (
    <g>
      <Panel suit={props.suit} color={ink} />
      {/* shoulders + chest */}
      <path d="M31 110v-8c0-11 8.5-16 19-16s19 5 19 16v8Z" fill={ink} />
      <ellipse cx="50" cy="105" rx="10" ry="7" fill={CREAM} />
      <path d="M45 102q2.5 2 5 0M50 102q2.5 2 5 0M45 106q2.5 2 5 0M50 106q2.5 2 5 0" stroke="#00000030" stroke-width="0.8" fill="none" stroke-linecap="round" />
      {/* head */}
      <circle cx="50" cy="62" r="16" fill={ink} />
      {/* cream face patch — raptor mask breaks the dark mass */}
      <path d="M50 50c6 0 11 5 11 11 0 6-5 10-11 10s-11-4-11-10c0-6 5-11 11-11Z" fill={CREAM} opacity="0.92" />
      {/* fierce brows + eyes */}
      <path d="M39.5 55.5l9 3M60.5 55.5l-9 3" stroke="#1c1c1c" stroke-width="1.7" stroke-linecap="round" />
      <circle cx="44" cy="62" r="2.9" fill="#fff" />
      <circle cx="56" cy="62" r="2.9" fill="#fff" />
      <circle cx="44.7" cy="62.5" r="1.6" fill="#1c1c1c" />
      <circle cx="56.7" cy="62.5" r="1.6" fill="#1c1c1c" />
      <circle cx="45.2" cy="61.9" r="0.5" fill="#fff" />
      <circle cx="57.2" cy="61.9" r="0.5" fill="#fff" />
      {/* hooked beak — compact, obvious hook */}
      <path d="M46.5 66.5h6.5c1.6 0 2.8 1.1 2.8 2.7 0 3.6-2.2 6.6-5.6 7.6 1.6-2.8 0.8-6.6-3.7-10.3Z" fill={GOLD} stroke={GOLD_DARK} stroke-width="0.7" />
      <path d="M48.5 68.5h3.6" stroke={GOLD_DARK} stroke-width="0.6" stroke-linecap="round" />
      {/* beanie hugging the head */}
      <path d="M35 54c1.5-8.5 7.5-13.5 15-13.5S63.5 45.5 65 54l.3 2H34.7Z" fill={GOLD} stroke={GOLD_DARK} stroke-width="0.7" />
      <path d="M34.5 56h31.3c.9 1.7-.4 3.2-2.4 3.2H36.9c-2 0-3.3-1.5-2.4-3.2Z" fill={GOLD_DARK} />
      <path d="M42 46.5q8-5 16 0" stroke={GOLD_DARK} stroke-width="0.8" fill="none" stroke-opacity="0.55" />
      <circle cx="50" cy="41.5" r="1.7" fill={CREAM} stroke={GOLD_DARK} stroke-width="0.5" />
      {/* feather plume — clearly separate, sticking up-right */}
      <path d="M63 42c4-7 9-10 14-10-0.5 6-3.5 11-9 13.5Z" fill={ink} opacity="0.92" />
      <path d="M63.5 43.5c4-5.5 8-8.5 12-9.5" stroke={CREAM} stroke-width="0.7" fill="none" stroke-opacity="0.6" />
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
