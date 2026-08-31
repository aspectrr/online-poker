/**
 * RiverRats mark: a rat's head over a river wave.
 * Stroke-based (currentColor) so it inherits the accent color
 * from the existing tinted-square treatment in the headers.
 */
export function Logo(props: { class?: string }) {
  return (
    <svg
      class={props.class}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {/* ears */}
      <circle cx="7.8" cy="6.8" r="2.9" />
      <circle cx="16.2" cy="6.8" r="2.9" />
      {/* head, tapering to the snout */}
      <path d="M5 8.6C4.7 13 6.6 16.8 12 18.6c5.4-1.8 7.3-5.6 7-10" />
      {/* eyes + nose */}
      <path d="M9.2 12.7h.01M14.8 12.7h.01M12 16.6h.01" stroke-width="2.2" />
      {/* whiskers */}
      <path d="M3.4 14.7l3 .8M3.7 17.5l2.9-.5M20.6 14.7l-3 .8M20.3 17.5l-2.9-.5" />
      {/* the river */}
      <path d="M3.5 21.3c1.4-1.2 2.9-1.2 4.3 0s2.8 1.2 4.2 0 2.8-1.2 4.2 0 2.9 1.2 4.3 0" />
    </svg>
  )
}
