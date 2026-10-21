import Link from 'next/link';
import { ArrowRight, ExternalLink } from 'lucide-react';

// A standalone action: bold, arrow, no underline. `external` opens a preview in a new tab.
export function ActionLink({ href, children, external }: { href: string; children: React.ReactNode; external?: boolean }) {
  if (external) {
    return (
      <a className="go" href={href} target="_blank" rel="noopener noreferrer">
        {children}
        <ExternalLink className="i" aria-hidden="true" focusable="false" />
      </a>
    );
  }
  return (
    <Link className="go" href={href}>
      {children}
      <ArrowRight className="i" aria-hidden="true" focusable="false" />
    </Link>
  );
}
