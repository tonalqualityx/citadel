'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// Client portal interview prep (Feature 2). Lists question sets for any of this client's runs
// that are ready_for_interview with an open (not-yet-complete) interview. Answers here are
// SUPPLEMENTARY prep material — saving never advances the run or marks the interview complete;
// the human/skill-driven live call still does that (via interview-complete). Nothing is final.

interface SavedAnswer {
  question_index: number | null;
  question: string | null;
  answer: string;
  answered_at: string;
  contact_id: string;
}

interface InterviewEntry {
  run_id: string;
  run_title: string;
  questions: unknown;
  answers: SavedAnswer[];
  interview_status: string;
}

function questionText(q: unknown, index: number): string {
  if (typeof q === 'string') return q;
  if (q && typeof q === 'object' && 'question' in (q as Record<string, unknown>)) {
    const obj = q as { question?: string };
    return obj.question || `Question ${index + 1}`;
  }
  return `Question ${index + 1}`;
}

function InterviewCard({
  entry,
  onSaved,
}: {
  entry: InterviewEntry;
  onSaved: (runId: string, answers: SavedAnswer[]) => void;
}) {
  const questions = Array.isArray(entry.questions) ? entry.questions : [];
  const [drafts, setDrafts] = useState<string[]>(() =>
    questions.map((_, i) => entry.answers.find((a) => a.question_index === i)?.answer ?? '')
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function handleSave() {
    if (saving) return;
    setError(null);
    setSavedAt(null);

    const answers = questions
      .map((_, i) => ({ question_index: i, answer: (drafts[i] ?? '').trim() }))
      .filter((a) => a.answer.length > 0);

    if (answers.length === 0) {
      setError('Write at least one answer before saving.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/portal/interview/${entry.run_id}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'We couldn’t save your answers. Please try again.');
        return;
      }
      const payload: { run_id: string; answers: SavedAnswer[] } = await res.json();
      onSaved(entry.run_id, payload.answers);
      setSavedAt(Date.now());
    } catch {
      setError('We couldn’t save your answers. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold text-text-main">{entry.run_title}</h2>
      <p className="mt-1 text-sm text-text-tertiary">
        These help us prepare for your upcoming call. Nothing here is final — answer as much or as
        little as you&apos;d like, and we&apos;ll cover the rest together live.
      </p>

      <div className="mt-5 space-y-5">
        {questions.map((q, i) => (
          <div key={i}>
            <label
              htmlFor={`q-${entry.run_id}-${i}`}
              className="mb-1.5 block text-sm font-medium text-text-main"
            >
              {questionText(q, i)}
            </label>
            <textarea
              id={`q-${entry.run_id}-${i}`}
              value={drafts[i] ?? ''}
              onChange={(e) => {
                setDrafts((prev) => {
                  const next = [...prev];
                  next[i] = e.target.value;
                  return next;
                });
              }}
              rows={3}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-main placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
              placeholder="Your answer (optional)"
            />
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-brand-primary px-4 py-2 text-sm text-white transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save answers'}
        </button>
        <span aria-live="polite" className="text-sm">
          {error ? (
            <span className="text-error">{error}</span>
          ) : savedAt ? (
            <span className="text-text-tertiary">Saved</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

export default function PortalInterviewPage() {
  const router = useRouter();
  const [interviews, setInterviews] = useState<InterviewEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/portal/interview');
        if (res.status === 401) {
          router.replace('/portal/login');
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || 'We couldn’t load your interview prep.');
          return;
        }
        const payload: { interviews: InterviewEntry[] } = await res.json();
        setInterviews(payload.interviews);
      } catch {
        setError('We couldn’t load your interview prep.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  function handleSaved(runId: string, answers: SavedAnswer[]) {
    setInterviews((prev) => (prev ? prev.map((e) => (e.run_id === runId ? { ...e, answers } : e)) : prev));
  }

  if (loading) {
    return <p className="text-sm text-text-tertiary">Loading…</p>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <p className="text-sm text-text-main">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/portal" className="text-sm text-brand-primary hover:underline">
          ← Back
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-text-main">Interview prep</h1>
        <p className="mt-1 text-sm text-text-tertiary">
          A few questions to help us prepare for your upcoming call. Answering ahead of time is
          optional — we&apos;ll go through everything together either way.
        </p>
      </div>

      {(interviews ?? []).length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center">
          <p className="text-sm text-text-tertiary">Nothing waiting on you right now.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {(interviews ?? []).map((entry) => (
            <InterviewCard key={entry.run_id} entry={entry} onSaved={handleSaved} />
          ))}
        </div>
      )}
    </div>
  );
}
