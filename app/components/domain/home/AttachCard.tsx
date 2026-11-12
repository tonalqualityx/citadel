'use client';

import * as React from 'react';
import Link from 'next/link';
import type { HomeActRequest, HomeItem, HomeItemAction } from '@/lib/home/types';
import { ATTACH_CARD } from '@/lib/work/attach-copy';
import { plain } from './home-screen-logic';

export interface AttachCardProps {
  /** The one attach question (item.attach set). */
  item: HomeItem;
  /** Not now, and any button the card carries that is a plain home action. */
  onAction: (action: HomeItemAction, item: HomeItem) => void;
  /** The attach answer. Resolves when the server answered. */
  onAct: (request: HomeActRequest) => Promise<unknown>;
  busy?: boolean;
}

const LinkOrAnchor = ({ href, children }: { href: string; children: React.ReactNode }) =>
  href.startsWith('/') ? (
    <Link href={href}>{children}</Link>
  ) : (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );

/**
 * The attach question (Work stage D): it is not clear which piece of work this email or session belongs to. Each candidate name is a link;
 * the buttons are one per candidate, New project, Just a task (only when the source names one deliverable) and Not work. Nothing is
 * attached until a tap, and every answer has Undo.
 */
export function AttachCard({ item, onAction, onAct, busy = false }: AttachCardProps) {
  const att = item.attach;
  const [working, setWorking] = React.useState(false);
  if (!att) return null;
  const off = busy || working;
  const answer = async (choice: string) => {
    setWorking(true);
    try {
      await onAct({ action: 'attach_choose', item_key: att.key, choice });
    } catch {
      // The hook already showed one plain sentence.
    } finally {
      setWorking(false);
    }
  };
  const notNow = item.actions.find((a) => a.id === 'not_now');
  return (
    <div className="home-card" data-item-key={item.key} data-testid="attach-card">
      <h2>{plain(item.title)}</h2>
      <div className="home-meta">{item.age ? <span>{plain(item.age)}</span> : null}</div>
      {att.source_href ? (
        <p className="home-small">
          <LinkOrAnchor href={att.source_href}>{ATTACH_CARD.openSource}</LinkOrAnchor>
        </p>
      ) : null}
      {att.candidates.length > 0 ? (
        <ul className="home-small" data-testid="attach-candidates">
          {att.candidates.map((c) => (
            <li key={c.choice}>
              <LinkOrAnchor href={c.href}>{plain(c.label)}</LinkOrAnchor>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="home-actions">
        {att.candidates.map((c) => (
          <button key={c.choice} type="button" className="home-btn" data-testid="attach-candidate-button" disabled={off} onClick={() => void answer(c.choice)}>
            {plain(c.label)}
          </button>
        ))}
        {att.can_new_project ? (
          <button type="button" className="home-btn" disabled={off} onClick={() => void answer('new_project')}>
            {ATTACH_CARD.newProject}
          </button>
        ) : null}
        {att.can_task ? (
          <button type="button" className="home-btn" disabled={off} onClick={() => void answer('task')}>
            {ATTACH_CARD.justATask}
          </button>
        ) : null}
        <button type="button" className="home-btn" disabled={off} onClick={() => void answer('not_work')}>
          {ATTACH_CARD.notWork}
        </button>
        {notNow ? (
          <button type="button" className="home-btn" disabled={off} onClick={() => onAction(notNow, item)}>
            {plain(notNow.label)}
          </button>
        ) : null}
      </div>
      {item.default_if_ignored ? <p className="home-small">{plain(item.default_if_ignored)}</p> : null}
      {item.reason ? <p className="home-foot">Why it&apos;s here: {plain(item.reason)}</p> : null}
    </div>
  );
}
