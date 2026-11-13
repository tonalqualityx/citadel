'use client';

import * as React from 'react';
import Link from 'next/link';
import type { HomeOverdueOthers } from '@/lib/home/types';
import { overdueDaysLabel } from '@/lib/home/overdue-copy';
import { plain } from './home-screen-logic';

export interface OverdueOthersProps {
  overdue: HomeOverdueOthers;
  emptyText: string;
}

/**
 * The "Overdue by others" tab: who is late, on what, in which project, and by how many days. A list he looks at; there is nothing to tap but the
 * task link, and nothing here sends or asks anything.
 */
export function OverdueOthers({ overdue, emptyText }: OverdueOthersProps) {
  if (overdue.rows.length === 0) {
    return (
      <section className="home-card home-pane" data-testid="overdue-board" aria-label="Overdue by others">
        <p className="home-muted" data-testid="overdue-empty">{emptyText}</p>
      </section>
    );
  }
  return (
    <section className="home-card home-pane" data-testid="overdue-board" aria-label="Overdue by others">
      <ul className="home-olist">
        {overdue.rows.map((r) => (
          <li key={r.task_id} className="home-orow" data-testid="overdue-row">
            <span className="home-owho">{plain(r.who)}</span>
            <Link href={r.href} className="home-otitle">
              {plain(r.title)}
            </Link>
            <span className="home-oproject home-small home-muted">{r.project_name ? plain(r.project_name) : 'No project'}</span>
            <span className="home-odays home-small" data-testid="overdue-days">{overdueDaysLabel(r.days_overdue)}</span>
          </li>
        ))}
      </ul>
      {overdue.count > overdue.rows.length ? (
        <p className="home-small home-muted">{`Showing the ${overdue.rows.length} most overdue of ${overdue.count}.`}</p>
      ) : null}
    </section>
  );
}
