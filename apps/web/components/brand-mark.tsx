/**
 * The mark: a citation bracket around a point.
 *
 * It is the one idea the product is built on drawn as a glyph. Every answer points back
 * at the passage it came from, and `[1]` is how it does that, so the mark is that bracket
 * with nothing inside it but the point it refers to.
 *
 * Drawn as paths rather than set as a letter, so it renders the same before the webfont
 * arrives and outside the application, where the favicon has no font to borrow.
 */
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.75" y="1.75" width="20.5" height="20.5" rx="6" />
      <path d="M10 7.25H8.25v9.5H10" />
      <path d="M14 7.25h1.75v9.5H14" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
