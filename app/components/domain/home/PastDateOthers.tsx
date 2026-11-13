'use client';

import * as React from 'react';
import Link from 'next/link';
import type { HomePastDateOthers } from '@/lib/home/types';
import { OTHERS_TAB_TITLE, pastDateDaysLabel } from '@/lib/home/others-copy';
import { plain } from './home-screen-logic';

export interface PastDateOthersProps {
  others: HomePastDateOthers;
  emptyText: string;
}

/**
 * The "overdue by others" tab: who is late, on what, in which project, and by how many days. A list he looks at; there is nothing to tap but the
 * task link, and nothing here sends or asks anything.
 */
export function PastDateOthers({ others, emptyText }: PastDateOthersProps) {
  if (others.rows.length === 0) {
    return (
      <section className="home-card home-pane" data-testid="others-board" aria-label={OTHERS_TAB_TITLE}>
        <p className="home-muted" data-testid="others-empty">{emptyText}</p>
      </section>
    );
  }
  return (
    <section className="home-card home-pane" data-testid="others-board" aria-label={OTHERS_TAB_TITLE}>
      <ul className="home-olist">
        {others.rows.map((r) => (
          <li key={r.task_id} className="home-orow" data-testid="others-row">
            <span className="home-owho">{plain(r.who)}</span>
            <Link href={r.href} className="home-otitle">
              {plain(r.title)}
            </Link>
            <span className="home-oproject home-small home-muted">{r.project_name ? plain(r.project_name) : 'No project'}</span>
            <span className="home-odays home-small" data-testid="others-days">{pastDateDaysLabel(r.days_past)}</span>
          </li>
        ))}
      </ul>
      {others.count > others.rows.length ? (
        <p className="home-small home-muted">{`Showing the ${others.rows.length} furthest past their date of ${others.count}.`}</p>
      ) : null}
    </section>
  );
}
