// Sunk blocks the shape of the final layout. No spinner, no shimmer, no "Loading" text.
export function Skeleton({ lines = 3, block = false }: { lines?: number; block?: boolean }) {
  return (
    <div className="skel" aria-hidden="true">
      {block ? <span className="skel-block" /> : null}
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skel-line" style={{ width: `${100 - (i % 3) * 18}%` }} />
      ))}
    </div>
  );
}

// Announces to assistive tech once, without a visible spinner or text.
export function SkeletonRegion({ children, label = 'Page content' }: { children: React.ReactNode; label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}
