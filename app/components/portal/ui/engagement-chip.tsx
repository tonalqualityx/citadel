import Link from 'next/link';
import { engagementText, type Engagement } from '@/lib/portal/engagement';

// "Project: Website relaunch", "Retainer: Marketing plan" or "Request: example.com". Each links to
// its page; a chip with no destination renders as text.
export function EngagementChip({ engagement }: { engagement: Engagement }) {
  const text = engagementText(engagement);
  const cls = 'inline-flex shrink-0 items-center rounded-md bg-surface-secondary px-2 py-0.5 text-xs font-medium text-text-secondary';
  if (!engagement.href) return <span className={cls}>{text}</span>;
  return (
    <Link href={engagement.href} className={`${cls} hover:text-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}>
      {text}
    </Link>
  );
}
