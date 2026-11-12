'use client';

import * as React from 'react';
import type { HomeDoneWhen } from '@/lib/home/types';
import { plain } from './home-screen-logic';

export const ANSWER_MAX = 2000;
export const CHECKLIST_SAVED_LINE = 'Your answers are saved on the task. Bast reads them on its next pass.';

export interface DoneWhenListProps {
  taskId: string | null;
  items: HomeDoneWhen[];
  /** Tick or untick one item. Resolves true when it was saved. Without the three handlers the list is display only. */
  onTick?: (taskId: string, itemId: string, completed: boolean) => Promise<boolean>;
  /** Save an answer (a task comment) and tick the item, in one call. */
  onAnswer?: (taskId: string, itemId: string, answer: string) => Promise<boolean>;
  /** Save a note on the task (a task comment only). */
  onNote?: (taskId: string, note: string) => Promise<boolean>;
}

/** The "Done when" list: real checkboxes, an Answer link on each unticked row, and one general note box. */
export function DoneWhenList({ taskId, items, onTick, onAnswer, onNote }: DoneWhenListProps) {
  const live = Boolean(taskId && onTick && onAnswer && onNote);
  const [ticks, setTicks] = React.useState<Record<string, boolean>>({});
  const [answered, setAnswered] = React.useState<Record<string, string>>({});
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [note, setNote] = React.useState('');
  const [noteSaved, setNoteSaved] = React.useState(false);

  // A fresh card from the server replaces whatever was guessed.
  React.useEffect(() => {
    setTicks({});
    setAnswered({});
  }, [items]);
  React.useEffect(() => {
    setOpenId(null);
    setDraft('');
    setNote('');
    setNoteSaved(false);
  }, [taskId]);

  const isDone = (d: HomeDoneWhen) => (d.id && d.id in ticks ? ticks[d.id] : d.done);

  async function tick(d: HomeDoneWhen, next: boolean) {
    if (!live || !d.id) return;
    const id = d.id;
    setTicks((t) => ({ ...t, [id]: next }));
    const ok = await onTick!(taskId!, id, next);
    if (!ok) setTicks((t) => ({ ...t, [id]: !next }));
  }

  async function saveAnswer(d: HomeDoneWhen) {
    if (!live || !d.id) return;
    const text = draft.trim();
    if (!text) return;
    const id = d.id;
    setBusy(id);
    const ok = await onAnswer!(taskId!, id, text);
    setBusy(null);
    if (ok) {
      setTicks((t) => ({ ...t, [id]: true }));
      setAnswered((a) => ({ ...a, [id]: text }));
      setOpenId(null);
      setDraft('');
    }
  }

  async function saveNote() {
    const text = note.trim();
    if (!live || !text) return;
    setBusy('note');
    const ok = await onNote!(taskId!, text);
    setBusy(null);
    if (ok) {
      setNote('');
      setNoteSaved(true);
    }
  }

  return (
    <>
      <h3>Done when</h3>
      {items.map((d, i) => {
        const done = isDone(d);
        const saved = (d.id && answered[d.id]) || d.answer || null;
        const canTick = live && Boolean(d.id);
        const boxId = `done-when-${taskId ?? 'x'}-${i}`;
        return (
          <div key={`${i}-${d.text}`}>
            <div className="home-check">
              {canTick ? (
                <input
                  id={boxId}
                  type="checkbox"
                  className="home-checkbox"
                  checked={done}
                  onChange={(e) => void tick(d, e.target.checked)}
                />
              ) : (
                <span className="home-box" data-done={done ? 'true' : undefined} aria-hidden="true" />
              )}
              <span>
                {canTick ? <label htmlFor={boxId}>{plain(d.text)}</label> : plain(d.text)}
                {saved ? <span className="home-muted"> (answered)</span> : done && !canTick ? <span className="home-muted"> (done)</span> : null}
                {canTick && !done && openId !== d.id ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="home-linkbtn"
                      aria-label={`Answer: ${d.text}`}
                      onClick={() => {
                        setOpenId(d.id!);
                        setDraft('');
                      }}
                    >
                      Answer
                    </button>
                  </>
                ) : null}
              </span>
            </div>
            {saved ? <p className="home-muted home-small home-answer">{saved}</p> : null}
            {canTick && openId === d.id ? (
              <div className="home-answer-box">
                <textarea
                  aria-label={`Your answer: ${d.text}`}
                  value={draft}
                  maxLength={ANSWER_MAX}
                  rows={2}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div>
                  <button type="button" className="home-linkbtn" disabled={busy === d.id || draft.trim() === ''} onClick={() => void saveAnswer(d)}>
                    Save
                  </button>{' '}
                  <button type="button" className="home-linkbtn" onClick={() => setOpenId(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
      {live ? (
        <div className="home-answer-box">
          <label className="home-small" htmlFor={`done-when-note-${taskId}`}>
            Note for this task
          </label>
          <textarea
            id={`done-when-note-${taskId}`}
            value={note}
            maxLength={ANSWER_MAX}
            rows={2}
            onChange={(e) => {
              setNote(e.target.value);
              setNoteSaved(false);
            }}
          />
          <div>
            <button type="button" className="home-linkbtn" disabled={busy === 'note' || note.trim() === ''} onClick={() => void saveNote()}>
              Save note
            </button>
            {noteSaved ? <span className="home-muted home-small"> Saved.</span> : null}
          </div>
          <p className="home-muted home-small">{CHECKLIST_SAVED_LINE}</p>
        </div>
      ) : null}
    </>
  );
}
