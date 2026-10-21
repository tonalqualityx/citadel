import { BarChart3 } from 'lucide-react';
import { ActionLink } from '@/components/portal/ui/action-link';

export interface LatestReport {
  title: string;
  headline: string | null;
  period: string;
  url: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-09" to "September 2026"; anything else is returned as it came. */
export function reportPeriodLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  const name = MONTHS[Number(m[2]) - 1];
  return name ? `${name} ${m[1]}` : period;
}

// A drawn thumbnail of the report, the period, the headline, and the link to read it.
export function ReportLink({ report }: { report: LatestReport }) {
  return (
    <div className="rcard report" data-kind="retainer">
      <div className="thumb" aria-hidden="true">
        <span className="mast" />
        <span className="tl1" />
        <span className="tl2" />
        <BarChart3 className="i thumb-ic" focusable="false" />
        <span className="tl2" style={{ width: '60%' }} />
      </div>
      <div className="report-body">
        <p className="meta">
          {report.title} · {reportPeriodLabel(report.period)}
        </p>
        {report.headline ? <p className="big">{report.headline}</p> : null}
        <ActionLink href={report.url} external>
          Read the report
        </ActionLink>
      </div>
    </div>
  );
}
