import type { LucideIcon } from 'lucide-react';
import type { Engagement } from '@/lib/portal/engagement';
import { StatusChip, type ChipProps } from './status-chip';
import { EngagementChip } from './engagement-chip';
import { SiteMark } from './site-mark';

// One row inside the Needs you callout: icon, title, optional question text, chip, kind, site, actions.
export function NeedsYouItem({
  icon: Icon, title, detail, chip, engagement, site, extra, actions,
}: {
  icon: LucideIcon;
  title: string;
  detail?: string | null;
  chip: ChipProps;
  engagement?: Engagement | null;
  site?: string | null;
  extra?: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <li>
      <span className="ic" aria-hidden="true">
        <Icon className="i" focusable="false" />
      </span>
      <div className="body">
        <p className="ttl">{title}</p>
        {detail ? <p className="q">{detail}</p> : null}
        <div className="meta">
          <StatusChip {...chip} />
          {engagement ? <EngagementChip engagement={engagement} /> : null}
          {site ? <SiteMark name={site} /> : null}
          {extra}
        </div>
        <div className="actions">{actions}</div>
      </div>
    </li>
  );
}
