'use client';

import * as React from 'react';
import Link from 'next/link';
import type { HomeActRequest, HomeFinishedRow, HomeItem, HomeItemAction } from '@/lib/home/types';
import { FINISHED_CARD } from '@/lib/work/finished-copy';
import { plain } from './home-screen-logic';

export interface FinishedCardProps {
  /** The one looks-finished row (item.finished set). */
  item: HomeItem;
  /** Not now, and any button the card carries that is a plain home action. */
  onAction: (action: HomeItemAction, item: HomeItem) => void;
  /** The three finished acts (Close the ticked ones, Close this one, Not finished). Resolves when the server answered. */
  onAct: (request: HomeActRequest) => Promise<unknown>;
  busy?: boolean;
}

function Evidence({ row }: { row: HomeFinishedRow }) {
  return (
    <ul className="home-small home-muted">
      {row.evidence.map((e, i) => (
        <li key={i}>
          {e.href && e.href.startsWith('/') ? <Link href={e.href}>{plain(e.line)}</Link> : e.href ? <a href={e.href} target="_blank" rel="noopener noreferrer">{plain(e.line)}</a> : plain(e.line)}
        </li>
      ))}
    </ul>
  );
}

/**
 * The looks-finished card (Work stage G): the tasks that have proof of their own that the work is done. Nothing closes until a tap.
 * Main list with tick boxes (strong proof ticked, medium not); security and portal rows, each with its own Close this one; rows with
 * an unticked checklist item (Open only); and the old session sweep's tasks with their own button.
 */
export function FinishedCard({ item, onAction, onAct, busy = false }: FinishedCardProps) {
  const fin = item.finished;
  const rows = fin?.rows ?? [];
  const [ticked, setTicked] = React.useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.key, r.ticked])));
  const [working, setWorking] = React.useState(false);
  React.useEffect(() => {
    setTicked((prev) => Object.fromEntries(rows.map((r) => [r.key, r.key in prev ? prev[r.key] : r.ticked])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => r.key).join('|')]);
  if (!fin) return null;
  const off = busy || working;
  const by = (g: HomeFinishedRow['group']) => rows.filter((r) => r.group === g);
  const run = async (req: HomeActRequest) => {
    setWorking(true);
    try {
      await onAct(req);
    } catch {
      // The hook already showed one plain sentence.
    } finally {
      setWorking(false);
    }
  };
  const tickedKeys = (g: HomeFinishedRow['group']) => by(g).filter((r) => ticked[r.key]).map((r) => r.key);
  const notNow = item.actions.find((a) => a.id === 'not_now');

  const keepBtn = (r: HomeFinishedRow) => (
    <button type="button" className="home-btn" disabled={off} onClick={() => void run({ action: 'finished_keep', item_key: r.key })}>
      {FINISHED_CARD.notFinished}
    </button>
  );
  const title = (r: HomeFinishedRow) => (
    <Link href={r.href}>
      <strong>{plain(r.title)}</strong>
    </Link>
  );
  const tickList = (g: 'main' | 'orphan') =>
    by(g).map((r) => (
      <div key={r.key} className="home-finished-row" data-item-key={r.key} data-group={g}>
        <label>
          <input type="checkbox" checked={!!ticked[r.key]} disabled={off} onChange={(e) => setTicked((t) => ({ ...t, [r.key]: e.target.checked }))} /> {title(r)}
        </label>
        <Evidence row={r} />
        <div className="home-actions">{keepBtn(r)}</div>
      </div>
    ));
  const oneTapList = (g: 'security' | 'portal') =>
    by(g).map((r) => (
      <div key={r.key} className="home-finished-row" data-item-key={r.key} data-group={g}>
        <p>{title(r)}</p>
        <Evidence row={r} />
        <div className="home-actions">
          <button type="button" className="home-btn" disabled={off} onClick={() => void run({ action: 'finished_close_one', item_key: r.key })}>
            {FINISHED_CARD.closeThis}
          </button>
          {keepBtn(r)}
        </div>
      </div>
    ));

  const main = by('main');
  const security = by('security');
  const portal = by('portal');
  const unticked = by('unticked');
  const orphan = by('orphan');
  return (
    <div className="home-card" data-item-key={item.key} data-testid="finished-card">
      <h2>{plain(item.title)}</h2>
      <div className="home-meta">{item.age ? <span>{plain(item.age)}</span> : null}</div>
      {item.why_now ? <p className="home-why">{plain(item.why_now)}</p> : null}
      {main.length > 0 ? <div className="home-finished-group">{tickList('main')}</div> : null}
      <div className="home-actions">
        <button
          type="button"
          className="home-btn"
          data-filled="true"
          disabled={off || tickedKeys('main').length === 0}
          onClick={() => void run({ action: 'finished_close', item_keys: tickedKeys('main').slice(0, 100) })}
        >
          {FINISHED_CARD.closeTicked}
        </button>
        {notNow ? (
          <button type="button" className="home-btn" disabled={off} onClick={() => onAction(notNow, item)}>
            {FINISHED_CARD.notNow}
          </button>
        ) : null}
      </div>
      {security.length > 0 ? (
        <div className="home-finished-group" data-testid="finished-security">
          <h3>{FINISHED_CARD.securityHead(security.length)}</h3>
          {oneTapList('security')}
        </div>
      ) : null}
      {portal.length > 0 ? (
        <div className="home-finished-group" data-testid="finished-portal">
          <h3>{FINISHED_CARD.portalHead(portal.length)}</h3>
          {oneTapList('portal')}
        </div>
      ) : null}
      {unticked.length > 0 ? (
        <div className="home-finished-group" data-testid="finished-unticked">
          <h3>{FINISHED_CARD.untickedHead(unticked.length)}</h3>
          {unticked.map((r) => (
            <div key={r.key} className="home-finished-row" data-item-key={r.key} data-group="unticked">
              <p>{title(r)}</p>
              <Evidence row={r} />
              <div className="home-actions">
                <Link className="home-btn" href={r.href}>
                  {FINISHED_CARD.open}
                </Link>
                {keepBtn(r)}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {orphan.length > 0 ? (
        <div className="home-finished-group" data-testid="finished-orphan">
          <h3>{FINISHED_CARD.orphanHead(orphan.length)}</h3>
          {tickList('orphan')}
          <div className="home-actions">
            <button type="button" className="home-btn" disabled={off || tickedKeys('orphan').length === 0} onClick={() => void run({ action: 'finished_close', item_keys: tickedKeys('orphan').slice(0, 100) })}>
              {FINISHED_CARD.closeOrphans}
            </button>
          </div>
        </div>
      ) : null}
      {fin.others.map((line) => (
        <p key={line} className="home-small home-muted">
          {plain(line)}
        </p>
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
