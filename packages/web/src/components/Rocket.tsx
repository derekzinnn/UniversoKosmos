/**
 * The little Kosmos rocket, hand-drawn as inline SVG — no library, nothing
 * licensed. Shared by the login fly-by and the lesson-completion streak. The
 * flame trails from the bottom, so a rotation on the wrapper points the whole
 * thing (nose + exhaust) in its direction of travel.
 */
export function Rocket({ className }: { className?: string }) {
  return (
    <svg
      width="34"
      height="52"
      viewBox="0 0 32 48"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      {/* Exhaust, trailing behind. */}
      <path d="M12 30 L16 46 L20 30 Z" fill="#3b6fe0" />
      <path d="M14 30 L16 40 L18 30 Z" fill="#cfe0f8" />

      {/* Fins */}
      <path d="M11 25 L6 33 L11 31 Z" fill="#0140bf" />
      <path d="M21 25 L26 33 L21 31 Z" fill="#0140bf" />

      {/* Body + nose */}
      <path d="M16 2 L11 13 L21 13 Z" fill="#0140bf" />
      <rect x="11" y="12" width="10" height="19" rx="4.5" fill="#ffffff" stroke="#0140bf" strokeWidth="1.8" />
      <circle cx="16" cy="19" r="2.4" fill="#0140bf" />
    </svg>
  );
}
