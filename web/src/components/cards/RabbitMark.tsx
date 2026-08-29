import { splitProps } from 'solid-js'
import { cn } from '../../lib/cn'

export type RabbitMarkProps = {
  /** pixel size (square) */
  size?: number
  class?: string
}

/**
 * Rabbit mascot — the rabbit-hunt mark. Flat character-mark face in the
 * card-court style (round face, cream fill, warm accents). Used in
 * rabbit-hunt toasts and wherever the mascot is needed.
 */
export function RabbitMark(props: RabbitMarkProps) {
  const [local] = splitProps(props, ['size', 'class'])
  const s = () => local.size ?? 32
  return (
    <svg
      width={s()}
      height={s()}
      viewBox="0 0 64 64"
      class={cn('shrink-0', local.class)}
      role="img"
      aria-label="rabbit"
    >
      {/* ears */}
      <path d="M24 26c-2-10 0-20 4-21 3-1 4 8 4 19Z" fill="#fdf9f0" stroke="#d9c9a3" stroke-width="1.6" />
      <path d="M40 26c2-10 0-20-4-21-3-1-4 8-4 19Z" fill="#fdf9f0" stroke="#d9c9a3" stroke-width="1.6" />
      <path d="M26 22c-1-6 0-12 2-13M38 22c1-6 0-12-2-13" stroke="#e8b8b8" stroke-width="2" stroke-linecap="round" fill="none" />
      {/* head */}
      <circle cx="32" cy="38" r="16" fill="#fdf9f0" stroke="#d9c9a3" stroke-width="1.6" />
      {/* eyes */}
      <circle cx="26.5" cy="36" r="2" fill="#2b2b2b" />
      <circle cx="37.5" cy="36" r="2" fill="#2b2b2b" />
      <circle cx="27.2" cy="35.3" r="0.6" fill="#fff" />
      <circle cx="38.2" cy="35.3" r="0.6" fill="#fff" />
      {/* nose + mouth */}
      <path d="M32 40.5l-2-1.6h4Z" fill="#e05252" />
      <path d="M32 41.5v1.8M32 43.3l-2 1.8M32 43.3l2 1.8" stroke="#2b2b2b" stroke-width="1.2" fill="none" stroke-linecap="round" />
      {/* cheeks */}
      <circle cx="23" cy="41" r="2" fill="#f4b942" opacity="0.5" />
      <circle cx="41" cy="41" r="2" fill="#f4b942" opacity="0.5" />
      {/* whiskers */}
      <path d="M18 38h-5M18 42l-5 2M46 38h5M46 42l5 2" stroke="#d9c9a3" stroke-width="1.1" stroke-linecap="round" />
      {/* buck teeth */}
      <path d="M30.5 45.5h3v3.2a1.5 1.5 0 0 1-3 0Z" fill="#fff" stroke="#d9c9a3" stroke-width="0.9" />
    </svg>
  )
}
