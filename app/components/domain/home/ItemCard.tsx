'use client';

import * as React from 'react';
import Link from 'next/link';
import type { HomeItemAction, HomeLink, ItemCardProps } from '@/lib/home/types';
import { useTaskPeek } from '@/lib/contexts/task-peek-context';
import { ACTION_LABELS } from '@/lib/home/copy';
import { bastReadLine, CLOSE_LEAD_LABEL, NOT_LEAD_ASK, SHORT_DRAFT_TITLE, suggestedAnswerLine, TREAT_AS_REPLY_LABEL } from '@/lib/home/owed/copy';
import { RULE_ASK_TITLE, RULE_REASON_MAX, RULE_SAVE_LABEL } from '@/lib/home/emergency/copy';
import { plain } from './home-screen-logic';
import { WorkClockLines } from './WorkClockLines';
import { DoneWhenList } from './DoneWhenList';

/** The time choices of a sent-mail card: minutes, null for none. */
const NUMBER_MAX = 1440;

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
  onSaveRule,
  onChecklistTick,
  onChecklistAnswer,
  onChecklistNote,
  hideActions = false,
}: ItemCardExtraProps) {
  const { openTaskPeek } = useTaskPeek();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const itemKey = item?.key ?? null;
  // Slice 6a: "Not an emergency" on crisis mail and site rows asks "Why? This becomes a rule." before it saves.
  const [pickOpen, setPickOpen] = React.useState(false);
  const [pickScope, setPickScope] = React.useState<string | null>(null);
  const [pickReason, setPickReason] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  // Slice 4c: "Not a lead" asks whether to treat the thread as a reply or close it.
  const [leadPickOpen, setLeadPickOpen] = React.useState(false);
  // "Do it on a day": the quick choices open under More.
  const [dayPickOpen, setDayPickOpen] = React.useState<'on_day' | 'snooze' | null>(null);
  // Slice 9a, a card from his sent mail: the minutes chosen (null = no time entry) and whether the time is billable.
  const proposalTime = item?.proposal?.time ?? null;
  const [minutes, setMinutes] = React.useState<number | null>(proposalTime && item?.proposal?.kind === 'track' ? proposalTime.default : null);
  const [notBillable, setNotBillable] = React.useState(false);
  React.useEffect(() => {
    setMinutes(proposalTime && item?.proposal?.kind === 'track' ? proposalTime.default : null);
    setNotBillable(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);
  React.useEffect(() => {
    setLeadPickOpen(false);
    setDayPickOpen(null);
    setMoreOpen(false);
    setPickOpen(false);
    setPickScope(null);
    setPickReason('');
  }, [itemKey]);

  if (!item) {
    return (
      <div className="home-card">
        <p className="home-muted">{plain(emptyText)}</p>
      </div>
    );
  }

  const busy = pendingAction != null;
  const scopes = item.not_emergency_scopes ?? [];
  const o = item.opened;
  const doneWhen = o.done_when.length >= 2 ? o.done_when : [];
  const hasLeft = Boolean(o.summary) || doneWhen.length > 0 || Boolean(o.left_off_note) || Boolean(o.draft_text) || Boolean(o.short_draft_text) || Boolean(o.bast_read) || Boolean(o.suggested_answer);
  const hasRight = Boolean(o.how) || o.links.length > 0 || Boolean(o.task_id) || Boolean(item.default_if_ignored);

  const button = (a: HomeItemAction) => (
    <button
      key={a.id}
      type="button"
      className="home-btn"
      data-filled={a.filled ? 'true' : undefined}
      disabled={busy}
      aria-busy={pendingAction === a.id ? 'true' : undefined}
      onClick={() => {
        if (a.id === 'not_emergency' && scopes.length > 0 && onSaveRule) {
          setPickScope(scopes[0].scope);
          setPickOpen(true);
          return;
        }
        if (a.id === 'not_lead') {
          setLeadPickOpen(true);
          return;
        }
        if ((a.id === 'on_day' || a.id === 'snooze') && a.choices && a.choices.length > 0) {
          const which: 'on_day' | 'snooze' = a.id;
          setDayPickOpen((v) => (v === which ? null : which));
          return;
        }
        if (item.proposal && (a.id === 'track_it' || (a.id === 'proposal_yes' && item.proposal.time))) {
          onAction({ ...a, minutes, billable: !notBillable }, item);
          return;
        }
        onAction(a, item);
      }}
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
      {item.work_line ? <p className="home-why" data-testid="work-line">{plain(item.work_line)}</p> : null}
      {item.outside_check ? <p className="home-why" data-testid="outside-check">{plain(item.outside_check)}</p> : null}

      {item.proposal ? (
        <div className="home-prompt home-proposal" data-testid="proposal">
          {item.proposal.lines.map((l, i) => (
            <p key={`${i}-${l}`} className={i === 0 ? undefined : 'home-small'}>
              {plain(l)}
            </p>
          ))}
          <p className="home-muted home-small">{plain(item.proposal.why)}</p>
          {proposalTime ? (
            <div role="group" aria-label="Time spent">
              <p className="home-small">{item.proposal.kind === 'track' ? 'Time spent (minutes). Change it before you tap.' : 'Log time with it (minutes):'}</p>
              <div className="home-actions">
                {item.proposal.kind !== 'track' ? (
                  <button type="button" className="home-btn" data-filled={minutes === null ? 'true' : undefined} disabled={busy} onClick={() => setMinutes(null)}>
                    None
                  </button>
                ) : null}
                {proposalTime.choices.map((m) => (
                  <button key={m} type="button" className="home-btn" data-filled={minutes === m ? 'true' : undefined} disabled={busy} onClick={() => setMinutes(m)}>
                    {m}
                  </button>
                ))}
                <input
                  type="number"
                  className="home-rulepick-input"
                  aria-label="Minutes"
                  min={1}
                  max={NUMBER_MAX}
                  value={minutes !== null && !proposalTime.choices.includes(minutes) ? minutes : ''}
                  disabled={busy}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value));
                    setMinutes(Number.isFinite(n) && n > 0 ? Math.min(n, NUMBER_MAX) : null);
                  }}
                />
              </div>
              {proposalTime.billable_choice ? (
                <label className="home-rulepick-row">
                  <input type="checkbox" checked={notBillable} disabled={busy} onChange={(e) => setNotBillable(e.target.checked)} />
                  <span>Not billable</span>
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

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

      {leadPickOpen ? (
        <div className="home-prompt" role="group" aria-label={NOT_LEAD_ASK}>
          <p>{NOT_LEAD_ASK}</p>
          <div className="home-actions">
            <button
              type="button"
              className="home-btn"
              data-filled="true"
              disabled={busy}
              onClick={() => {
                setLeadPickOpen(false);
                onAction({ id: 'treat_as_reply', label: ACTION_LABELS.treat_as_reply, filled: false, href: null }, item);
              }}
            >
              {TREAT_AS_REPLY_LABEL}
            </button>
            <button
              type="button"
              className="home-btn"
              disabled={busy}
              onClick={() => {
                setLeadPickOpen(false);
                onAction({ id: 'close_lead', label: ACTION_LABELS.close_lead, filled: false, href: null }, item);
              }}
            >
              {CLOSE_LEAD_LABEL}
            </button>
            <button type="button" className="home-btn" onClick={() => setLeadPickOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {dayPickOpen ? (
        <div className="home-prompt" role="group" aria-label={ACTION_LABELS[dayPickOpen]}>
          <p>{ACTION_LABELS[dayPickOpen]}</p>
          <div className="home-actions">
            {(item.more_actions.find((x) => x.id === dayPickOpen)?.choices ?? []).map((c) => (
              <button
                key={c.label}
                type="button"
                className="home-btn"
                disabled={busy}
                onClick={() => {
                  const id = dayPickOpen;
                  setDayPickOpen(null);
                  onAction({ id, label: ACTION_LABELS[id], filled: false, href: null, date: c.date, hours: c.hours, until: c.until }, item);
                }}
              >
                {plain(c.label)}
              </button>
            ))}
            <button type="button" className="home-btn" onClick={() => setDayPickOpen(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {pickOpen && scopes.length > 0 && onSaveRule ? (
        <div className="home-prompt home-rulepick" role="group" aria-label={RULE_ASK_TITLE}>
          <p>{RULE_ASK_TITLE}</p>
          {scopes.map((s) => (
            <label key={s.scope} className="home-rulepick-row">
              <input
                type="radio"
                name={`rule-scope-${item.key}`}
                checked={pickScope === s.scope}
                onChange={() => setPickScope(s.scope)}
              />
              <span>{plain(s.label)}</span>
            </label>
          ))}
          <label className="home-rulepick-row">
            <span className="home-muted home-small">Reason, if you want one</span>
            <input
              type="text"
              className="home-rulepick-input"
              maxLength={RULE_REASON_MAX}
              value={pickReason}
              onChange={(e) => setPickReason(e.target.value)}
            />
          </label>
          <div className="home-actions">
            <button
              type="button"
              className="home-btn"
              data-filled="true"
              disabled={saving || pickScope === null}
              onClick={() => {
                if (pickScope === null) return;
                setSaving(true);
                onSaveRule(item, pickScope as 'sender' | 'domain' | 'site', pickReason)
                  .then((ok) => {
                    if (ok) setPickOpen(false);
                  })
                  .finally(() => setSaving(false));
              }}
            >
              {RULE_SAVE_LABEL}
            </button>
            <button type="button" className="home-btn" disabled={saving} onClick={() => setPickOpen(false)}>
              Cancel
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
      {item.not_emergency_refusal ? <p className="home-muted home-small">{plain(item.not_emergency_refusal)}</p> : null}
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
              {o.short_draft_text ? (
                <div>
                  <h3>{SHORT_DRAFT_TITLE}</h3>
                  <p className="home-draft">{o.short_draft_text}</p>
                </div>
              ) : null}
              {o.left_off_note ? (
                <div>
                  <h3>Where you left off</h3>
                  <p className="home-note">{plain(o.left_off_note)}</p>
                </div>
              ) : null}
              {doneWhen.length > 0 ? (
                <DoneWhenList taskId={o.task_id} items={doneWhen} onTick={onChecklistTick} onAnswer={onChecklistAnswer} onNote={onChecklistNote} />
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
              {o.task_id ? <WorkClockLines targetKey={`task:${o.task_id}`} /> : null}
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
      {o.effort_basis ? <p className="home-foot">{plain(o.effort_basis)}</p> : null}
    </div>
  );
}
