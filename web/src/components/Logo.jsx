/**
 * The mark is an aperture blade inside a frame: the two things this product
 * does, framing a shot and holding a fixed subject inside it. Drawn rather
 * than lettered so it survives at 20px in the app bar.
 */
export default function Logo({ size = 22 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* frame, with the corners cut away like crop marks */}
      <path
        d="M3 8V4.8A1.8 1.8 0 0 1 4.8 3H8M16 3h3.2A1.8 1.8 0 0 1 21 4.8V8M21 16v3.2a1.8 1.8 0 0 1-1.8 1.8H16M8 21H4.8A1.8 1.8 0 0 1 3 19.2V16"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      {/* the subject held at the centre */}
      <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 8.6V5.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}
