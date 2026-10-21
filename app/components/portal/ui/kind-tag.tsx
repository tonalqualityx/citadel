import Link from 'next/link';
import type { Kind } from './icons';

// A swatch in the kind color plus the written kind: "Project: Website relaunch".
export function KindTag({ kind, label, href }: { kind: Kind; label: string; href?: string | null }) {
  if (href) {
    return (
      <Link href={href} className="kind" data-kind={kind}>
        {label}
      </Link>
    );
  }
  return (
    <span className="kind" data-kind={kind}>
      {label}
    </span>
  );
}
