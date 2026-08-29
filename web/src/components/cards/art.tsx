import { type JSX } from 'solid-js'
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
        y="30"
        font-size={ten ? '24' : '40'}
        font-weight="800"
        letter-spacing={ten ? '-2' : '-1'}
        stroke={props.ink}
        stroke-width="1.1"
        paint-order="stroke"
        style="font-family: var(--font-display), ui-sans-serif, system-ui, sans-serif"
      >
        {RANK_LABEL[props.rank]}
      </text>
      <g transform="translate(0 42) scale(0.2) translate(-50 -50)">
        <SuitPath suit={props.suit} />
      </g>
    </g>
  )
}

/**
 * Center motif — THE one motif on every rank, modern-minimal:
 * a thin diagonal rule passing behind a large suit glyph. No pips,
 * no court portraits; the giant corner rank carries the value.
 */
export function CenterMotif(props: { suit: Suit; color: string }): JSX.Element {
  return (
    <g>
      <line x1="24" y1="116" x2="76" y2="24" stroke={props.color} stroke-width="3" stroke-linecap="round" opacity="0.28" />
      <g transform="translate(50 70) scale(0.46) translate(-50 -50)">
        <g fill={props.color}>
          <SuitPath suit={props.suit} />
        </g>
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
