'use client';

import * as React from 'react';
import type { HomeActionId, HomeItem, HomeItemAction } from '@/lib/home/types';
import { plain } from './home-screen-logic';

export interface HandsCardProps {
  /** The Monday row (item.hands set). */
  item: HomeItem;
  onAction: (action: HomeItemAction, item: HomeItem) => void;
  /** The action in flight on a given item (a job or the row), or null. */
  pendingFor: (item: HomeItem) => HomeActionId | null;
}

/** The jobs buttons, in this order: Done, I'll do it now, Open. Taken from the job's own task buttons. */
const JOB_BUTTONS: readonly HomeActionId[] = ['done', 'do_now', 'open_task'];

/** "This week's hands" (Slice 6a): the jobs of the week, grouped by their written steps, "No written steps" last. */
export function HandsCard({ item, onAction, pendingFor }: HandsCardProps) {
  const hands = item.hands;
  const rowBusy = pendingFor(item) != null;
  if (!hands) return null;
  return (
    <div className="home-card" data-item-key={item.key}>
      <h2>{plain(item.title)}</h2>
      <div className="home-meta">
        {item.effort ? <span>{plain(item.effort)}</span> : null}
      </div>
      {item.why_now ? <p className="home-why">{plain(item.why_now)}</p> : null}
      <div className="home-actions">
        {item.actions.map((a) => (
          <button key={a.id} type="button" className="home-btn" data-filled={a.filled ? 'true' : undefined} disabled={rowBusy} onClick={() => onAction(a, item)}>
            {plain(a.label)}
          </button>
        ))}
      </div>
      {hands.groups.map((g) => (
        <div key={g.sop_id ?? 'none'} className="home-hands-group">
          <h3>{plain(g.label)}</h3>
          {g.jobs.map((j) => {
            const own = [...j.item.actions, ...j.item.more_actions];
            const buttons = JOB_BUTTONS.map((id) => own.find((a) => a.id === id)).filter((a): a is HomeItemAction => !!a);
            const busy = pendingFor(j.item) != null;
            return (
              <div key={j.item.key} className="home-hands-job" data-item-key={j.item.key}>
                <p>
                  <strong>{plain(j.title)}</strong> <span className="home-muted home-small">About {j.minutes} minutes</span>
                </p>
                <div className="home-actions">
                  {buttons.map((a) => (
                    <button key={a.id} type="button" className="home-btn" disabled={busy} aria-busy={pendingFor(j.item) === a.id ? 'true' : undefined} onClick={() => onAction(a, j.item)}>
                      {plain(a.label)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {item.default_if_ignored ? (
        <>
          <h3>If you do nothing</h3>
          <p className="home-small">{plain(item.default_if_ignored)}</p>
        </>
      ) : null}
      {item.reason ? <p className="home-foot">Why it&apos;s here: {plain(item.reason)}</p> : null}
    </div>
  );
}
