'use client';

import * as React from 'react';
import type { QuestionView } from '@/lib/tasks/question-context';
import { QUESTION_BUTTONS } from '@/lib/tasks/triage-copy';
import { QUESTION_COPY, answeredDate } from './question-copy';

export interface QuestionListProps {
  questions: QuestionView[];
  /** Save an answer. Resolves true when it was saved. Without it the list is read only (everyone but Mike). */
  onAnswer?: (questionId: string, body: { option_id?: string; text?: string; version: string }) => Promise<boolean>;
  /** Start with the Context of every question open (the card page does not; tests do). */
  contextOpen?: boolean;
}

function safeUrl(u: string | undefined): string | null {
  return u && /^https?:\/\//i.test(u) ? u : null;
}

/** The Context of one question, in place: what it is, who said what, what was checked, what is unknown, the options, the recommendation, and what happens if nobody decides. */
export function QuestionContext({ q }: { q: QuestionView }) {
  const opts = q.options ?? [];
  return (
    <div className="home-blk home-small" data-testid="question-context">
      <p>
        <strong>{QUESTION_COPY.whatItIs}</strong> {q.what_it_is}
      </p>
      <div className="home-blk">
        <strong>{QUESTION_COPY.sources}</strong>
        <ul>
          {q.sources.map((s, i) => {
            const url = safeUrl(s.url);
            return (
              <li key={i}>
                {s.who}
                {s.at ? ` (${s.at})` : ''}: {s.said}
                {url ? (
                  <>
                    {' '}
                    <a href={url} target="_blank" rel="noreferrer">
                      {QUESTION_COPY.link}
                    </a>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
      <p>
        <strong>{QUESTION_COPY.checked}</strong> {q.checked}
      </p>
      <p>
        <strong>{QUESTION_COPY.unknown}</strong> {q.unknown}
      </p>
      {opts.length > 0 ? (
        <div className="home-blk">
          <strong>{QUESTION_COPY.options}</strong>
          <ul>
            {opts.map((o) => (
              <li key={o.id}>
                {o.label}
                {o.id === q.recommended_option_id ? ` (${QUESTION_BUTTONS.recommended.toLowerCase()})` : ''}: {o.consequence}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {q.recommend_why ? (
        <p>
          <strong>{QUESTION_COPY.why}</strong> {q.recommend_why}
        </p>
      ) : null}
      <p>
        <strong>{QUESTION_COPY.ifNobody}</strong> {q.if_nobody} {q.if_nobody_action === 'wait' ? QUESTION_COPY.waitNote : QUESTION_COPY.goNote}
      </p>
    </div>
  );
}

function OneQuestion({ q, onAnswer, contextOpen }: { q: QuestionView; onAnswer?: QuestionListProps['onAnswer']; contextOpen: boolean }) {
  const [showContext, setShowContext] = React.useState(contextOpen);
  const [editing, setEditing] = React.useState(false);
  const [other, setOther] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const live = !!onAnswer;
  const answered = q.state === 'answered';
  const defaulted = q.state === 'defaulted';
  const collapsed = (answered || defaulted) && !editing;

  async function send(body: { option_id?: string; text?: string }) {
    if (!onAnswer) return;
    setBusy(true);
    const ok = await onAnswer(q.id, { ...body, version: q.version });
    setBusy(false);
    if (ok) {
      setEditing(false);
      setOther(false);
      setDraft('');
    }
  }

  const contextToggle = (
    <button type="button" className="home-linkbtn" aria-expanded={showContext} onClick={() => setShowContext((v) => !v)}>
      {showContext ? QUESTION_BUTTONS.hideContext : QUESTION_BUTTONS.context}
    </button>
  );

  if (collapsed) {
    return (
      <div className="home-note home-blk" data-testid="question" data-state={q.state}>
        <p className="home-small">
          {q.question} {'→'}{' '}
          {answered ? (
            <>
              <strong>{q.answer_text}</strong> <span className="home-muted">{'·'} {answeredDate(q.answered_at)}</span>
            </>
          ) : (
            <span className="home-muted">{QUESTION_COPY.defaulted}</span>
          )}{' '}
          {live ? (
            <button type="button" className="home-linkbtn" onClick={() => setEditing(true)}>
              {answered ? QUESTION_BUTTONS.change : QUESTION_COPY.answerNow}
            </button>
          ) : null}{' '}
          {contextToggle}
        </p>
        {showContext ? <QuestionContext q={q} /> : null}
      </div>
    );
  }

  const opts = q.options ?? [];
  return (
    <div className="home-note home-blk" data-testid="question" data-state={q.state}>
      <p>
        <strong>{q.question}</strong> {contextToggle}
      </p>
      {showContext ? <QuestionContext q={q} /> : null}
      {live ? (
        <>
          <div className="home-actions">
            {opts.map((o) => (
              <button
                key={o.id}
                type="button"
                className="home-btn"
                data-filled={o.id === q.recommended_option_id ? 'true' : undefined}
                disabled={busy}
                onClick={() => void send({ option_id: o.id })}
              >
                {o.id === q.recommended_option_id ? (
                  <span>
                    {o.label}
                    <br />
                    <span className="home-small">{QUESTION_BUTTONS.recommended}</span>
                  </span>
                ) : (
                  o.label
                )}
              </button>
            ))}
            {!other ? (
              <button type="button" className="home-btn" disabled={busy} onClick={() => setOther(true)}>
                {QUESTION_BUTTONS.other}
              </button>
            ) : null}
            {editing ? (
              <button type="button" className="home-btn" onClick={() => { setEditing(false); setOther(false); }}>
                {QUESTION_BUTTONS.cancel}
              </button>
            ) : null}
          </div>
          {other ? (
            <div className="home-answer-box">
              <textarea
                aria-label={QUESTION_BUTTONS.other}
                rows={3}
                maxLength={2000}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="home-actions">
                <button type="button" className="home-btn" data-filled="true" disabled={busy || draft.trim() === ''} onClick={() => void send({ text: draft.trim() })}>
                  {QUESTION_BUTTONS.send}
                </button>
                <button type="button" className="home-btn" onClick={() => { setOther(false); setDraft(''); }}>
                  {QUESTION_BUTTONS.cancel}
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className="home-small home-muted">{QUESTION_COPY.onlyMike}</p>
      )}
    </div>
  );
}

/** The questions on one card. Open ones show their option buttons and an Other answer box; answered ones fold to "question → answer, date" with a Change link. */
export function QuestionList({ questions, onAnswer, contextOpen = false }: QuestionListProps) {
  const shown = questions.filter((q) => q.state !== 'withdrawn');
  if (shown.length === 0) return <p className="home-small home-muted">{QUESTION_COPY.none}</p>;
  return (
    <div className="home-blk" data-testid="question-list">
      {shown.map((q) => (
        <OneQuestion key={q.id} q={q} onAnswer={onAnswer} contextOpen={contextOpen} />
      ))}
    </div>
  );
}
