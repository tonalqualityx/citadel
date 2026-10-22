// The Indelible logomark: the hexagon with the three stacked layers, from the logo in
// /Clients/Indelible design/references/logo.png. The only source is a raster (logo.svg is that PNG
// wrapped in an SVG), so this is a hand-drawn vector of the same shape. It paints with currentColor
// (the hexagon outline at full strength, the layers at 100, 62 and 32 percent) so it reads on the
// light and the dark portal themes without a second asset.
export function IndelibleMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Indelible"
      focusable="false"
      data-testid="indelible-mark"
    >
      <path d="M24 3 43 14v20L24 45 5 34V14Z" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <path d="m24 10 12 6.5L24 23 12 16.5Z" fill="currentColor" opacity=".32" />
      <path d="m24 17 12 6.5L24 30 12 23.5Z" fill="currentColor" opacity=".62" />
      <path d="m24 24 12 6.5L24 37 12 30.5Z" fill="currentColor" />
    </svg>
  );
}
