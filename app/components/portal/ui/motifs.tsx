// One landscape per screen, drawn into the bottom of a PageHeader. Decorative, aria-hidden, fills
// from the mood tokens only so both themes work. No animation, never under text.
const M = {
  sun: 'm-sun', l1: 'm-1', l2: 'm-2', l3: 'm-3', line: 'm-line', tree: 'm-tree', river: 'm-river',
};

const trees = (pts: [number, number, number][]) =>
  pts.map(([x, y, h], i) => <path key={i} className={M.tree} d={`M${x} ${y} l${h * 0.42} ${-h} l${h * 0.42} ${h}Z`} />);

export type MotifName = 'ridgeline' | 'contours' | 'field' | 'river' | 'spruce' | 'meadow';

export const MOTIFS: Record<MotifName, React.ReactNode> = {
  ridgeline: (
    <>
      <circle className={M.sun} cx="486" cy="62" r="18" />
      <path className={M.l1} d="M0 84 L54 58 L98 70 L156 36 L214 64 L270 40 L330 66 L398 30 L462 58 L520 42 L600 62 V120 H0Z" />
      <path className={M.l2} d="M0 96 C60 80 112 86 164 76 C214 66 256 82 306 74 C366 64 410 84 460 76 C516 66 564 80 600 74 V120 H0Z" />
      <path className={M.l3} d="M0 108 C84 98 146 104 226 96 C306 88 366 104 446 96 C506 90 562 100 600 96 V120 H0Z" />
      {trees([[96, 98, 16], [108, 99, 13], [412, 96, 17], [424, 97, 12]])}
    </>
  ),
  contours: (
    <>
      <path className={M.l1} d="M0 120 V92 C120 78 220 96 330 86 C440 76 520 92 600 84 V120Z" />
      <g transform="translate(470 119) scale(.4)">
        <path className={M.line} d="M-40 0 C-40 -22 -12 -34 16 -28 C44 -22 52 4 34 18 C14 32 -20 28 -32 16 C-38 10 -40 6 -40 0Z" />
        <path className={M.line} d="M-70 0 C-70 -40 -20 -58 26 -48 C72 -38 86 6 58 30 C26 54 -36 48 -58 26 C-66 18 -70 10 -70 0Z" />
        <path className={M.line} d="M-100 2 C-100 -58 -28 -84 38 -70 C104 -56 122 8 82 42 C38 78 -52 70 -84 38 C-96 26 -100 14 -100 2Z" />
        <path className={M.line} d="M-134 4 C-134 -78 -36 -112 50 -94 C138 -76 160 12 108 56 C52 104 -70 94 -112 52 C-128 36 -134 20 -134 4Z" />
      </g>
      <g transform="translate(120 112) scale(.8)">
        <path className={M.line} d="M-60 0 C-60 -18 -20 -30 14 -24 C46 -18 58 0 40 12 C18 24 -40 20 -54 10Z" />
        <path className={M.line} d="M-90 2 C-90 -30 -26 -50 24 -40 C72 -30 90 2 62 22 C28 42 -60 36 -82 18Z" />
      </g>
    </>
  ),
  field: (
    <>
      <circle className={M.sun} cx="120" cy="62" r="15" />
      <path className={M.l1} d="M0 72 C140 44 330 40 600 64 V120 H0Z" />
      <path className={M.line} d="M0 84 C140 58 330 54 600 78" />
      <path className={M.line} d="M0 96 C140 72 330 68 600 92" />
      <path className={M.line} d="M0 108 C140 86 330 82 600 106" />
      <path className={M.l2} d="M0 116 C160 104 340 100 600 114 V120 H0Z" />
      {trees([[452, 62, 18], [466, 63, 14], [480, 64, 17], [540, 66, 15]])}
    </>
  ),
  river: (
    <>
      <path className={M.l1} d="M0 70 L70 50 L130 62 L210 34 L290 58 L360 44 L440 60 L520 38 L600 52 V120 H0Z" />
      <path className={M.l2} d="M0 120 V88 C120 80 200 92 300 86 C400 80 500 92 600 86 V120Z" />
      <path className={M.river} strokeWidth="14" d="M-10 112 C90 112 120 96 200 98 S320 116 400 104 S520 92 610 100" />
      <path className={M.line} d="M-10 104 C90 104 120 88 200 90 S320 108 400 96 S520 84 610 92" />
      {trees([[60, 82, 15], [72, 83, 12], [332, 80, 16], [548, 80, 15], [560, 81, 11]])}
    </>
  ),
  spruce: (
    <>
      <path className={M.l1} d="M0 96 C150 84 300 90 450 82 C520 78 570 84 600 82 V120 H0Z" />
      {trees([[300, 92, 30], [324, 92, 22], [344, 90, 34], [372, 90, 26], [398, 88, 38], [430, 88, 28], [458, 86, 32]])}
      <path className={M.line} d="M0 104 C160 96 320 100 600 94" />
    </>
  ),
  meadow: (
    <>
      <circle className={M.sun} cx="470" cy="70" r="14" />
      <path className={M.l1} d="M0 96 L80 80 L150 88 L240 70 L330 86 L420 74 L520 88 L600 80 V120 H0Z" />
      <path className={M.l3} d="M0 112 C120 104 240 110 360 104 C460 100 540 106 600 104 V120 H0Z" />
    </>
  ),
};

export function Motif({ name, className }: { name: MotifName; className?: string }) {
  return (
    <svg viewBox="0 0 600 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false" className={className}>
      {MOTIFS[name]}
    </svg>
  );
}

// The all-clear art: the meadow at small scale plus a spruce-colored flag.
export function AllClearArt() {
  return (
    <svg className="art" viewBox="0 0 168 96" aria-hidden="true" focusable="false">
      <circle className={M.sun} cx="118" cy="34" r="16" />
      <path className={M.l1} d="M0 70 L30 52 L52 60 L84 38 L112 58 L140 46 L168 56 V96 H0Z" />
      <path className={M.l2} d="M0 80 C40 70 70 76 104 70 C130 66 150 74 168 70 V96 H0Z" />
      <path className={M.l3} d="M0 90 C50 84 96 90 168 86 V96 H0Z" />
      <path d="M40 80 V60" stroke="var(--p-kind-retainer)" strokeWidth="2" fill="none" />
      <path d="M40 60 h14 l-3 5 3 5 h-14Z" fill="var(--p-kind-retainer)" />
    </svg>
  );
}
