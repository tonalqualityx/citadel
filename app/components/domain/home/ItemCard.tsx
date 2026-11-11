'use client';

import * as React from 'react';
import Link from 'next/link';
import type { HomeItemAction, HomeLink, ItemCardProps } from '@/lib/home/types';
import { useTaskPeek } from '@/lib/contexts/task-peek-context';
import { bastReadLine, suggestedAnswerLine } from '@/lib/home/owed/copy';
import { plain } from './home-screen-logic';

export interface ItemCardExtraProps extends ItemCardProps {
  /** The pinned item's card leaves its buttons to WorkingOnBar. */
  hideActions?: boolean;
}

function NamedLink({ link }: { link: HomeLink }) {
  const label = plain(link.label);
  if (link.href.startsWith('/')) return <Link href={link.href}>{label}</Link>;
  return (
    <a href={link.href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

/** The cold-open card (design 2B): statement, who and age, why now, buttons, then the detail. */
export function ItemCard({
  item,
  emptyText,
  onAction,
  pendingAction = null,
  statusText = null,
  prompt = null,
  onOpenProject,
  hideActions = false,
}: ItemCardExtraProps) {
  const { openTaskPeek } = useTaskPeek();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const itemKey = item?.key ?? null;
  React.useEffect(() => setMoreOpen(false), [itemKey]);

  if (!item) {
    return (
      <div className="home-card">
        <p className="home-muted">{plain(emptyText)}</p>
      </div>
    );
  }

  const busy = pendingAction != null;
  const o = item.opened;
  const doneWhen = o.done_when.length >= 2 ? o.done_when : [];
  const hasLeft = Boolean(o.summary) || doneWhen.length > 0 || Boolean(o.left_off_note) || Boolean(o.draft_text) || Boolean(o.bast_read) || Boolean(o.suggested_answer);
  const hasRight = Boolean(o.how) || o.links.length > 0 || Boolean(o.task_id) || Boolean(item.default_if_ignored);

  const button = (a: HomeItemAction) => (
    <button
      key={a.id}
      type="button"
      className="home-btn"
      data-filled={a.filled ? 'true' : undefined}
      disabled={busy}
      aria-busy={pendingAction === a.id ? 'true' : undefined}
      onClick={() => onAction(a, item)}
    >
      {plain(a.label)}
    </button>
  );

  return (
    <div className="home-card" data-item-key={item.key}>
      <h2>{plain(item.title)}</h2>
      <div className="home-meta">
        {item.hard_date ? <span className="home-pill">{plain(item.hard_date)}</span> : null}
        {item.who ? <span>{plain(item.who)}</span> : null}
        {item.age ? <span>{plain(item.age)}</span> : null}
        {item.owed_line ? <span>{plain(item.owed_line)}</span> : null}
        {item.effort ? <span>{plain(item.effort)}</span> : null}
        {item.project && onOpenProject ? (
          <button type="button" className="home-linkbtn" onClick={() => onOpenProject(item.project!.id)}>
            {plain(item.project.name)}
          </button>
        ) : null}
      </div>
      {item.why_now ? <p className="home-why">{plain(item.why_now)}</p> : null}

      {prompt ? (
        <div className="home-prompt" role="group" aria-label={prompt.text}>
          <p>{plain(prompt.text)}</p>
          <div className="home-actions">
            <button type="button" className="home-btn" data-filled="true" onClick={prompt.onConfirm}>
              {prompt.confirmLabel}
            </button>
            <button type="button" className="home-btn" onClick={prompt.onCancel}>
              {prompt.cancelLabel}
            </button>
          </div>
        </div>
      ) : null}

      {!hideActions ? (
        <div className="home-actions">
          {item.actions.map(button)}
          {item.more_actions.length > 0 ? (
            <button
              type="button"
              className="home-btn"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              More
            </button>
          ) : null}
        </div>
      ) : null}
      {!hideActions && moreOpen ? <div className="home-actions">{item.more_actions.map(button)}</div> : null}
      <p className="home-said" role="status">
        {statusText ? plain(statusText) : ''}
      </p>

      {hasLeft || hasRight ? (
        <div className="home-cols">
          {hasLeft ? (
            <div className="home-blk">
              {o.summary ? <p>{plain(o.summary)}</p> : null}
              {o.summary && o.summary_by === 'bast' ? <p className="home-muted home-small">Short version by Bast.</p> : null}
              {o.bast_read ? <p>{plain(bastReadLine(o.bast_read))}</p> : null}
              {o.suggested_answer ? <p>{plain(suggestedAnswerLine(o.suggested_answer))}</p> : null}
              {o.draft_text ? (
                <div>
                  <h3>The draft</h3>
                  <p className="home-draft">{o.draft_text}</p>
                </div>
              ) : null}
              {o.left_off_note ? (
                <div>
                  <h3>Where you left off</h3>
                  <p className="home-note">{plain(o.left_off_note)}</p>
                </div>
              ) : null}
              {doneWhen.length > 0 ? (
                <>
                  <h3>Done when</h3>
                  {doneWhen.map((d, i) => (
                    <div className="home-check" key={`${i}-${d.text}`}>
                      <span className="home-box" data-done={d.done ? 'true' : undefined} aria-hidden="true" />
                      <span>
                        {plain(d.text)}
                        {d.done ? <span className="home-muted"> (done)</span> : null}
                      </span>
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}
          {hasRight ? (
            <div className="home-blk">
              {o.how ? (
                <>
                  <h3>How</h3>
                  <p className="home-small">
                    <NamedLink link={o.how} />
                  </p>
                </>
              ) : null}
              {o.links.length > 0 || o.task_id ? (
                <>
                  <h3>Linked</h3>
                  <ul className="home-small">
                    {o.links.map((l) => (
                      <li key={`${l.href}-${l.label}`}>
                        <NamedLink link={l} />
                      </li>
                    ))}
                    {o.task_id ? (
                      <li>
                        <button type="button" className="home-linkbtn" onClick={() => openTaskPeek(o.task_id!)}>
                          Original notes
                        </button>
                      </li>
                    ) : null}
                  </ul>
                </>
              ) : null}
              {item.default_if_ignored ? (
                <>
                  <h3>If you do nothing</h3>
                  <p className="home-small">{plain(item.default_if_ignored)}</p>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {item.reason ? <p className="home-foot">Why it&apos;s here: {plain(item.reason)}</p> : null}
    </div>
  );
}
