'use client';

import Link from 'next/link';
import { CalendarDays, CircleCheck, Clock, Contrast, BarChart3, Target } from 'lucide-react';
import { PageHeader } from '@/components/portal/ui/page-header';
import { Section } from '@/components/portal/ui/section';
import { StatusChip } from '@/components/portal/ui/status-chip';
import { ProgressBar } from '@/components/portal/ui/progress-bar';
import { SiteMark } from '@/components/portal/ui/site-mark';
import { YearRibbon, type YearMonth } from '@/components/portal/ui/year-ribbon';
import { Legend } from '@/components/portal/ui/legend';
import { PortalButton } from '@/components/portal/ui/button';
import { PlanApprovalBlock, type PlanReady } from '@/components/portal/plan-approval-block';
import { ReportLink, type LatestReport } from '@/components/portal/report-link';
import { GoalRows, type GoalView } from '@/components/portal/goal-rows';
import type { ChipTone } from '@/lib/portal/status-labels';

export interface RetainerItemView {
  id: string;
  title: string;
  state: { label: string; tone: ChipTone };
  site: { id: string; name: string } | null;
  updated_at?: string;
}

export interface RetainerCardView {
  id: string;
  heading: string;
  status: { label: string; tone: ChipTone };
  period: string;
  covers: string[];
  allowance: string | null;
  plan_ready: PlanReady | null;
  this_month: { open: RetainerItemView[]; done: RetainerItemView[] };
  latest_report: LatestReport | null;
  year_label?: string | null;
  months?: YearMonth[];
  /** Present only when the portal KPI switch is on. */
  goals?: GoalView[];
}

const FULL: Record<string, string> = {
  Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June',
  Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December',
};

function shortDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
}

function Rows({ items, withDate }: { items: RetainerItemView[]; withDate: boolean }) {
  return (
    <ul className="rows">
      {items.map((i) => {
        const when = withDate ? shortDate(i.updated_at) : null;
        return (
          <li key={i.id}>
            <span className="t">
              <Link href={`/portal/work/${i.id}`}>{i.title}</Link>
            </span>
            <StatusChip label={i.state.label} tone={i.state.tone} />
            <span className="meta">
              {i.site ? <SiteMark name={i.site.name} /> : <span>All sites</span>}
              {when ? <span className="num">{when}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const LEGEND = [
  { swatch: 'kind' as const, value: 'var(--p-kind-retainer)', label: 'Report delivered' },
  {
    swatch: 'icon' as const, value: '', label: 'This month',
    icon: <i aria-hidden="true" className="sw-ring" />,
  },
  {
    swatch: 'icon' as const, value: '', label: 'Plan ready for you',
    icon: <i aria-hidden="true" className="sw-ready" />,
  },
  { swatch: 'state' as const, value: 'var(--p-sunk)', label: 'Still to come' },
];

// One plan: header, the plan waiting for approval, this month, the plan year, the latest report
// and the allowance line. Only the first plan on the page carries the H1.
export function RetainerCard({ card, primary, onChanged }: { card: RetainerCardView; primary: boolean; onChanged: () => void }) {
  const { open, done } = card.this_month;
  const covers = card.covers.length > 0 ? ` Covers ${card.covers.join(', ')}.` : '';
  const lede = `${card.period}.${covers}`;
  const months = card.months ?? [];
  const readyShort = months.find((m) => m.state === 'ready')?.label;
  const monthName = readyShort ? FULL[readyShort] ?? null : null;
  const total = open.length + done.length;

  return (
    <>
      {primary ? (
        <PageHeader
          eyebrow={['Retainer', <StatusChip key="s" label={card.status.label} tone={card.status.tone} />]}
          title={card.heading}
          lede={lede}
          motif="field"
          actions={<PortalButton variant="secondary" href="/portal/requests/new?type=marketing_question">Ask about your plan</PortalButton>}
        />
      ) : (
        <Section id={`plan-${card.id}`} title={card.heading} icon={CalendarDays} kind="retainer" aside={card.status.label}>
          <p className="sec-lede">{lede}</p>
        </Section>
      )}

      {card.plan_ready ? <PlanApprovalBlock plan={card.plan_ready} monthName={monthName} onChanged={onChanged} /> : null}

      <Section id={`month-${card.id}`} title="This month" icon={CalendarDays} kind="retainer">
        <div className="rcard" data-kind="retainer">
          {total === 0 ? (
            <p className="empty-line">Nothing scheduled for this period yet. Your plan for next month shows here when it is ready.</p>
          ) : (
            <>
              <ProgressBar done={done.length} total={total} label="done this period" kind="retainer" />
              {open.length > 0 ? (
                <>
                  <p className="groupname">
                    <Contrast className="i" aria-hidden="true" focusable="false" />
                    Moving ({open.length})
                  </p>
                  <Rows items={open} withDate={false} />
                </>
              ) : null}
              {done.length > 0 ? (
                <>
                  <p className="groupname">
                    <CircleCheck className="i" aria-hidden="true" focusable="false" />
                    Done ({done.length})
                  </p>
                  <Rows items={done} withDate />
                </>
              ) : null}
            </>
          )}
        </div>
      </Section>

      {card.goals && card.goals.length > 0 ? (
        <Section id={`goals-${card.id}`} title="Your goals" icon={Target} kind="retainer">
          <div className="rcard" data-kind="retainer">
            <GoalRows goals={card.goals} />
          </div>
        </Section>
      ) : null}

      {months.length > 0 ? (
        <Section id={`year-${card.id}`} title="Your plan year" icon={CalendarDays} kind="retainer" aside={card.year_label ?? undefined}>
          <div className="rcard" data-kind="retainer">
            <YearRibbon months={months} />
            <Legend entries={LEGEND} />
          </div>
        </Section>
      ) : null}

      <Section id={`report-${card.id}`} title="Latest report" icon={BarChart3} kind="retainer">
        {card.latest_report ? (
          <ReportLink report={card.latest_report} />
        ) : (
          <div className="rcard" data-kind="retainer">
            <p className="empty-line">Your first monthly report will show here.</p>
          </div>
        )}
      </Section>

      {card.allowance ? (
        <p className="allow">
          <Clock className="i" aria-hidden="true" focusable="false" />
          <span>{card.allowance}</span>
        </p>
      ) : null}
    </>
  );
}
