'use client';

import * as React from 'react';
import Link from 'next/link';
import type { HomeTriageProject } from '@/lib/home/types';
import { plain } from './home-screen-logic';
import { triageDatesLine } from '@/lib/tasks/triage-copy';

const PHASES_SHOWN = 6;
const PAGES_SHOWN = 3;

function dateWords(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** The contract state in plain words: signed with its date, sent, a draft, or none yet. */
export function contractLine(p: HomeTriageProject): string {
  const c = p.contract;
  if (!c) return p.deal ? 'No contract yet' : 'No deal linked yet';
  if (c.status === 'signed') {
    const when = dateWords(c.signed_at);
    return when ? `Contract signed ${when}` : 'Contract signed';
  }
  return c.status === 'sent' ? 'Contract sent, not signed yet' : 'Contract is still a draft';
}

function dealLink(p: HomeTriageProject): { href: string; label: string } | null {
  if (p.contract) return { href: p.contract.deal_href, label: p.deal ? p.deal.name : 'Open the deal' };
  return p.deal ? { href: p.deal.href, label: p.deal.name } : null;
}

function priceWords(v: string | null): string {
  return v === null ? 'no price' : `$${v}`;
}

/** What the deal sold, line by line, amounts as Citadel stores them. Read only; empty when the card has no deal detail. */
export function DealItems({ project }: { project: Pick<HomeTriageProject, 'deal_detail'> }) {
  const detail = project.deal_detail;
  if (!detail || detail.deals.length === 0) return null;
  return (
    <div data-testid="triage-deal-items">
      {detail.tie === 'client_signed_deals' ? <p className="home-small home-muted">{plain(detail.tie_note)}</p> : null}
      {detail.deals.map((d) => (
        <div key={d.id}>
          <p className="home-small">
            <strong>{plain(d.name)}</strong>
            {` · ${d.status}`}
            {d.total_value ? ` · total $${d.total_value}` : ''}
          </p>
          <ul>
            {d.items.commission.map((i) => (
              <li key={i.id} className="home-small">{`${plain(i.name)}: ${priceWords(i.final_price ?? i.estimated_price)}`}</li>
            ))}
            {d.items.charter.map((i) => (
              <li key={i.id} className="home-small">{`${plain(i.name)}: ${priceWords(i.final_price)} ${i.billing_period}, ${i.duration_months} months, $${i.total_contract_value} in all`}</li>
            ))}
            {d.items.keep.map((i) => (
              <li key={i.id} className="home-small">{`${plain(i.name ?? i.domain_name ?? 'Hosting and care')}: ${priceWords(i.monthly_total)} a month`}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * A project card's block. Compact (on the grid card): the contract state with a link to the deal, the phases as a short list with
 * "Yours" on the ones that need him, and the page count with the first few page names. Full (the card page): the shape with every
 * phase's summary, what will be his, the contract with its link, and the whole sitemap. Never a task and never the plan folder.
 */
export function TriageProjectBlock({ project }: { project: HomeTriageProject; variant?: 'compact' }) {
  const deal = dealLink(project);
  const pages = project.sitemap;
  const phases = project.phases;
  const dates = triageDatesLine(project.start_date, project.target_date);
  const datesNode = dates ? (
    <p className="home-small" data-testid="triage-dates">
      {dates}
    </p>
  ) : null;
  const contract = (
    <p className="home-small" data-testid="triage-contract">
      {contractLine(project)}
      {deal ? (
        <>
          {' · '}
          <Link href={deal.href}>{plain(deal.label)}</Link>
        </>
      ) : null}
    </p>
  );

  const shown = phases.slice(0, PHASES_SHOWN);
  const names = pages.slice(0, PAGES_SHOWN).map((x) => plain(x.name));
  const more = pages.length - names.length;
  return (
      <div className="home-tproject" data-testid="triage-project-compact">
        {contract}
        {datesNode}
        {phases.length > 0 ? (
          <ol className="home-tphases" aria-label="Phases">
            {shown.map((ph) => (
              <li key={ph.id}>
                <span>{plain(ph.name)}</span>
                {ph.mike_part ? <span className="home-yours" title={plain(ph.mike_part)}>Yours</span> : null}
              </li>
            ))}
            {phases.length > shown.length ? <li className="home-muted">{`+${phases.length - shown.length} more`}</li> : null}
          </ol>
        ) : (
          <p className="home-small home-muted">No phases drafted yet.</p>
        )}
        <p className="home-small">
          {pages.length === 0 ? 'No pages drafted yet.' : `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}: ${names.join(', ')}${more > 0 ? `, and ${more} more` : ''}`}
        </p>
      </div>
  );
}

/** The contract state in as few words as fit on a summary line: "No deal linked", "Signed Oct 20", "Contract sent", "Contract draft", "No contract yet". */
export function contractShort(p: HomeTriageProject): string {
  const c = p.contract;
  if (!c) return p.deal ? 'No contract yet' : 'No deal linked';
  if (c.status === 'signed') {
    const d = c.signed_at ? new Date(c.signed_at) : null;
    return d && !Number.isNaN(d.getTime()) ? `Signed ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Signed';
  }
  return c.status === 'sent' ? 'Contract sent' : 'Contract draft';
}

/**
 * The one summary line of the card page panel: facts laid out horizontally with separators, wrapping when it must. Zero counts say what is missing
 * ("0 phases"), so there are no placeholder sentences. The shape, what will be his, the sitemap and the deal's items live in the Plan tab.
 */
export function TriageFacts({ project, openQuestions }: { project: HomeTriageProject | null; openQuestions: number }) {
  const facts: string[] = [];
  if (project) {
    facts.push(contractShort(project));
    const launch = triageDatesLine(null, project.target_date);
    facts.push(launch || 'No launch date');
    facts.push(`${project.phases.length} ${project.phases.length === 1 ? 'phase' : 'phases'}`);
    facts.push(`${project.sitemap.length} ${project.sitemap.length === 1 ? 'page' : 'pages'}`);
    facts.push(`${project.mike_parts.length} yours`);
  }
  if (openQuestions > 0) facts.push(`${openQuestions} open ${openQuestions === 1 ? 'question' : 'questions'}`);
  if (facts.length === 0) return null;
  return (
    <ul className="home-tfacts home-small" data-testid="triage-facts" aria-label="Summary">
      {facts.map((f) => (
        <li key={f}>{f}</li>
      ))}
    </ul>
  );
}
