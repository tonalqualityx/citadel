import { engagementText, type Engagement } from '@/lib/portal/engagement';
import { KindTag } from './kind-tag';

// "Project: Website relaunch", "Retainer: Marketing plan" or "Request: example.com". Each links to
// its page; one with no destination renders as text.
export function EngagementChip({ engagement }: { engagement: Engagement }) {
  return <KindTag kind={engagement.kind} label={engagementText(engagement)} href={engagement.href} />;
}
