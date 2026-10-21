'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChoiceList } from './choice-list';
import { IntakeStep, type StepAnswer, type StepSpec } from './intake-step';
import { IntakeSummary } from './intake-summary';
import {
  ALL_SITES_LABEL,
  BUTTONS,
  NO_PERMISSION_MESSAGE,
  OPENING_CHOICES,
  OPENING_PROMPT,
  SENT_FOLLOW_UP,
  SENT_HEADING,
  SENT_LINK_LABEL,
  SENT_URGENT,
  SITE_IN_PROGRESS_SUFFIX,
  SITE_PROMPT,
  destinationLine,
  isIntakeType,
  isUrgentChoice,
  questionsFor,
  typeLabel,
  type IntakeType,
} from '@/lib/portal/intake/tree';
import { placeRequest, type PlacementCharter, type PlacementProject } from '@/lib/portal/intake/placement';

// The request chat (portal phase B slice 1, spec 2.2). A stepper that reads as a chat: Indelible's
// prompts on the left, answers on the right, one input at the bottom. The transcript is
// role="log"; each prompt is a fieldset and legend; Back edits the last answer. Nothing is
// sent until the summary's Send. The draft sits in sessionStorage under its intake_id.

interface ContextPayload {
  can_request: boolean;
  sites: Array<{ id: string; name: string; has_plan: boolean }>;
  open_builds: PlacementProject[];
  charters: Array<Omit<PlacementCharter, 'name' | 'start_date' | 'end_date' | 'created_at'> & {
    start_date: string;
    end_date: string | null;
    created_at: string;
    label: string;
  }>;
}

type Phase = 'type' | 'site' | 'q' | 'summary' | 'sent';

interface Draft {
  intakeId: string;
  type: IntakeType | null;
  siteSel: string | null;
  answers: Record<string, StepAnswer>;
  chosenProjectId: string;
}

const DRAFT_KEY = 'portal-intake-draft';

function loadDraft(): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}
function saveDraft(d: Draft | null) {
  try {
    if (d) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* sessionStorage can be blocked; the chat works without it */
  }
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
}

function answerText(a: StepAnswer | undefined, choices?: StepSpec['choices']): string {
  if (!a || a.value === '') return '';
  const c = choices?.find((x) => x.key === a.value);
  if (!c) return a.value;
  return a.detail ? `${c.label}: ${a.detail}` : c.label;
}

export function IntakeChat() {
  const router = useRouter();
  const [ctx, setCtx] = useState<ContextPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('type');
  const [intakeId, setIntakeId] = useState<string>('');
  const [type, setType] = useState<IntakeType | null>(null);
  const [siteSel, setSiteSel] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, StepAnswer>>({});
  const [qIndex, setQIndex] = useState(0);
  const [chosenProjectId, setChosenProjectId] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ id: string; urgent: boolean } | null>(null);

  // Load the context, then restore a draft or apply a prefill from the link.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/portal/intake/context');
        if (res.status === 401) {
          router.replace('/portal/login');
          return;
        }
        if (!res.ok) {
          if (!cancelled) setLoadError('We could not load this page. Please try again.');
          return;
        }
        const payload: ContextPayload = await res.json();
        if (cancelled) return;
        setCtx(payload);

        const draft = loadDraft();
        const params = new URLSearchParams(window.location.search);
        if (draft && draft.intakeId) {
          setIntakeId(draft.intakeId);
          setType(draft.type);
          setSiteSel(draft.siteSel);
          setAnswers(draft.answers ?? {});
          setChosenProjectId(draft.chosenProjectId ?? '');
          setPhase(draft.type ? (draft.siteSel !== null || !needsSiteStep(draft.type, payload) ? 'q' : 'site') : 'type');
          return;
        }
        setIntakeId(newId());
        // Prefill from a link (project page, retainer page, closed task). The server re-checks all of it.
        const t = params.get('type');
        const siteId = params.get('site_id');
        const projectId = params.get('project_id');
        let sel: string | null = null;
        if (siteId && payload.sites.some((s) => s.id === siteId)) sel = `site:${siteId}`;
        if (projectId) {
          const p = payload.open_builds.find((b) => b.id === projectId);
          if (p) {
            sel = p.site_id ? `site:${p.site_id}` : `project:${p.id}`;
            setChosenProjectId(p.id);
          }
        }
        if (t && isIntakeType(t)) {
          const opts = optionsFor(payload, t);
          if (!sel && opts.length === 1) sel = opts[0].key;
          if (!sel && opts.length === 0) sel = 'none';
          setType(t);
          setSiteSel(sel);
          setQIndex(0);
          setPhase(sel || !needsSiteStep(t, payload) ? 'q' : 'site');
        } else if (sel) {
          setSiteSel(sel);
        }
      } catch {
        if (!cancelled) setLoadError('We could not load this page. Please try again.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Keep the draft in sessionStorage while the chat is open.
  useEffect(() => {
    if (!intakeId || phase === 'sent') return;
    saveDraft({ intakeId, type, siteSel, answers, chosenProjectId });
  }, [intakeId, type, siteSel, answers, chosenProjectId, phase]);

  const siteOptions = useMemo(() => {
    if (!ctx || !type) return [];
    const opts: Array<{ key: string; label: string }> = [
      ...ctx.sites.map((s) => ({ key: `site:${s.id}`, label: s.name })),
      ...ctx.open_builds
        .filter((b) => b.site_id === null)
        .map((b) => ({ key: `project:${b.id}`, label: `${b.name} ${SITE_IN_PROGRESS_SUFFIX}` })),
    ];
    if (type === 'marketing_question' && opts.length > 1) opts.push({ key: 'all', label: ALL_SITES_LABEL });
    return opts;
  }, [ctx, type]);

  const questions = useMemo(() => (type ? questionsFor(type, answers.q1?.value) : []), [type, answers.q1?.value]);
  const stepSpecs: StepSpec[] = useMemo(
    () =>
      questions.map((q) => ({
        id: q.key,
        prompt: q.prompt,
        required: q.required,
        choices: q.choices?.map((c) => ({ key: c.key, label: c.label, line: c.line, followUp: c.follow_up })),
      })),
    [questions]
  );

  const afterType = useCallback(
    (t: IntakeType, c: ContextPayload) => {
      setQIndex(0);
      if (needsSiteStep(t, c)) {
        // Marketing adds "All my sites", which can make a single site a real choice.
        setPhase('site');
      } else {
        setPhase('q');
      }
    },
    []
  );

  function pickType(t: IntakeType) {
    if (!ctx) return;
    if (t !== type) {
      setAnswers({});
      setChosenProjectId('');
    }
    setType(t);
    // One site or none: pick it and skip the question.
    const opts = optionsFor(ctx, t);
    if (opts.length === 1) setSiteSel(opts[0].key);
    else if (opts.length === 0) setSiteSel('none');
    else if (siteSel && !opts.some((o) => o.key === siteSel)) setSiteSel(null);
    afterType(t, ctx);
  }

  function submitQuestion(i: number, a: StepAnswer) {
    const q = questions[i];
    setAnswers((prev) => {
      const next = { ...prev };
      // A different first answer on a "broken" request changes which questions follow.
      if (q.key === 'q1' && prev.q1?.value !== a.value) {
        delete next.q2;
        delete next.q3;
      }
      if (a.value === '') delete next[q.key];
      else next[q.key] = a;
      return next;
    });
    // The urgent "broken" choices have two questions; the list shortens as soon as q1 is known.
    const nextList = q.key === 'q1' && type ? questionsFor(type, a.value) : questions;
    if (i + 1 >= nextList.length) setPhase('summary');
    else setQIndex(i + 1);
  }

  function goBack() {
    if (phase === 'q') {
      if (qIndex > 0) setQIndex(qIndex - 1);
      else if (ctx && type && needsSiteStep(type, ctx)) setPhase('site');
      else setPhase('type');
    } else if (phase === 'site') setPhase('type');
  }

  // ---- Summary data ----
  const selection = useMemo(() => {
    if (!ctx || !siteSel) return { siteId: null as string | null, projectId: null as string | null, siteName: null as string | null };
    if (siteSel.startsWith('site:')) {
      const id = siteSel.slice(5);
      return { siteId: id, projectId: null, siteName: ctx.sites.find((s) => s.id === id)?.name ?? null };
    }
    if (siteSel.startsWith('project:')) {
      const id = siteSel.slice(8);
      const p = ctx.open_builds.find((b) => b.id === id);
      return { siteId: null, projectId: id, siteName: p ? `${p.name} ${SITE_IN_PROGRESS_SUFFIX}` : null };
    }
    return { siteId: null, projectId: null, siteName: siteSel === 'all' ? ALL_SITES_LABEL : null };
  }, [ctx, siteSel]);

  const summary = useMemo(() => {
    if (!ctx || !type) return null;
    const chosen = selection.projectId ?? (chosenProjectId || null);
    const placement = placeRequest({
      type,
      site_id: selection.siteId,
      chosen_project_id: chosen,
      site_has_plan: Boolean(selection.siteId && ctx.sites.find((s) => s.id === selection.siteId)?.has_plan),
      projects: ctx.open_builds,
      charters: ctx.charters.map((c) => ({
        id: c.id,
        name: c.label,
        site_id: c.site_id,
        status: c.status,
        start_date: new Date(c.start_date),
        end_date: c.end_date ? new Date(c.end_date) : null,
        created_at: new Date(c.created_at),
      })),
      content_kind: type === 'content_article' ? answers.q2?.value ?? null : null,
      now: new Date(),
    });
    return placement;
  }, [ctx, type, selection, chosenProjectId, answers.q2?.value]);

  const urgent = type ? isUrgentChoice(type, answers.q1?.value) : false;

  async function send() {
    if (!type || !summary) return;
    setSending(true);
    setSendError(null);
    try {
      const body = {
        intake_id: intakeId,
        type,
        site_id: selection.siteId,
        project_id: selection.projectId,
        chosen_project_id: !selection.projectId && chosenProjectId ? chosenProjectId : undefined,
        answers: questions
          .filter((q) => answers[q.key])
          .map((q) => ({ key: q.key, value: answers[q.key].value, ...(answers[q.key].detail ? { detail: answers[q.key].detail } : {}) })),
      };
      const res = await fetch('/api/portal/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        router.replace('/portal/login');
        return;
      }
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendError(payload.error || 'Something went wrong. Please try again.');
        return;
      }
      saveDraft(null);
      setSent({ id: payload.task.id, urgent: Boolean(payload.urgent) });
      setPhase('sent');
    } catch {
      setSendError('Something went wrong. Please try again.');
    } finally {
      setSending(false);
    }
  }

  function cancel() {
    saveDraft(null);
    router.push('/portal/home');
  }

  // ---- Render ----
  if (loadError) return <p role="alert" className="text-status-error">{loadError}</p>;
  if (!ctx) return <div className="py-20 text-center text-text-secondary">Loading…</div>;
  if (!ctx.can_request) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <p className="text-text-main">{NO_PERMISSION_MESSAGE}</p>
      </div>
    );
  }

  const transcript: Array<{ prompt: string; answer: string }> = [];
  if (type && phase !== 'type') {
    transcript.push({ prompt: OPENING_PROMPT, answer: typeLabel(type) });
    if (phase !== 'site' && siteOptions.length > 1 && selection.siteName) transcript.push({ prompt: SITE_PROMPT, answer: selection.siteName });
    stepSpecs.forEach((s, i) => {
      if (phase === 'q' && i >= qIndex) return;
      const t = answerText(answers[s.id], s.choices);
      if (t) transcript.push({ prompt: s.prompt, answer: t });
    });
  }

  if (phase === 'sent' && sent) {
    return (
      <section className="space-y-3 rounded-lg border border-border bg-surface p-6" aria-live="polite">
        <h2 className="text-xl font-bold text-text-main">{SENT_HEADING}</h2>
        {sent.urgent && <p className="font-semibold text-text-main">{SENT_URGENT}</p>}
        <p className="text-text-secondary">{SENT_FOLLOW_UP}</p>
        <p>
          <Link href={`/portal/work/${sent.id}`} className="font-semibold text-brand-primary underline">
            {SENT_LINK_LABEL}
          </Link>
        </p>
      </section>
    );
  }

  const placement = summary;
  const projectChoices = placement && !placement.ok ? placement.candidates.map((c) => ({ id: c.id, name: c.name })) : null;
  const okPlacement = placement && placement.ok ? placement : null;
  const projectName = okPlacement?.project_id ? ctx.open_builds.find((b) => b.id === okPlacement.project_id)?.name : null;
  const planName = okPlacement?.charter_id ? ctx.charters.find((c) => c.id === okPlacement.charter_id)?.label : null;

  return (
    <div className="space-y-6">
      {/* The summary repeats every answer, so the transcript steps aside for it. */}
      {transcript.length > 0 && phase !== 'summary' && (
        <div role="log" aria-label="Your request so far" className="space-y-3">
          {transcript.map((t) => (
            <div key={t.prompt} className="space-y-1">
              <p className="max-w-[85%] rounded-lg bg-surface-secondary px-3 py-2 text-sm text-text-main">{t.prompt}</p>
              <p className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main">{t.answer}</p>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface p-5">
        {phase === 'type' && (
          <fieldset className="space-y-3">
            <legend className="text-lg font-semibold text-text-main">{OPENING_PROMPT}</legend>
            <ChoiceList
              name="intake-type"
              options={OPENING_CHOICES}
              value={type}
              onChange={(k) => isIntakeType(k) && pickType(k)}
            />
          </fieldset>
        )}

        {phase === 'site' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (siteSel) setPhase('q');
            }}
          >
            <fieldset className="space-y-3">
              <legend className="text-lg font-semibold text-text-main">{SITE_PROMPT}</legend>
              <ChoiceList name="intake-site" options={siteOptions} value={siteSel} onChange={setSiteSel} />
            </fieldset>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="submit"
                disabled={!siteSel}
                className="min-h-[44px] rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {BUTTONS.next}
              </button>
              <button type="button" onClick={goBack} className="min-h-[44px] px-2 text-sm text-text-secondary underline">
                {BUTTONS.back}
              </button>
            </div>
          </form>
        )}

        {phase === 'q' && stepSpecs[qIndex] && (
          <IntakeStep
            key={`${type}-${stepSpecs[qIndex].id}-${qIndex}`}
            step={stepSpecs[qIndex]}
            initial={answers[stepSpecs[qIndex].id]}
            canGoBack
            onBack={goBack}
            onSubmit={(a) => submitQuestion(qIndex, a)}
          />
        )}

        {phase === 'summary' && type && (
          <IntakeSummary
            typeLabel={typeLabel(type)}
            siteName={selection.siteName}
            answers={questions
              .filter((q) => answers[q.key])
              .map((q) => ({ prompt: q.prompt, value: answerText(answers[q.key], stepSpecs.find((s) => s.id === q.key)?.choices) }))}
            destination={
              okPlacement
                ? destinationLine({ chain: okPlacement.chain, project_name: projectName, plan_name: planName, site_name: selection.siteName })
                : ''
            }
            quote={Boolean(okPlacement?.quote)}
            urgent={urgent}
            dateWords={type === 'new_page_feature' && answers.q3?.value === 'yes_date' ? answers.q3.detail ?? null : null}
            projectChoices={projectChoices}
            chosenProjectId={chosenProjectId}
            onChooseProject={setChosenProjectId}
            sending={sending}
            error={sendError}
            onSend={send}
            onChange={() => {
              setQIndex(Math.max(0, questions.length - 1));
              setPhase('q');
            }}
            onCancel={cancel}
          />
        )}
      </div>
    </div>
  );
}

function optionsFor(ctx: ContextPayload, type: IntakeType): Array<{ key: string }> {
  const opts: Array<{ key: string }> = [
    ...ctx.sites.map((s) => ({ key: `site:${s.id}` })),
    ...ctx.open_builds.filter((b) => b.site_id === null).map((b) => ({ key: `project:${b.id}` })),
  ];
  if (type === 'marketing_question' && opts.length > 1) opts.push({ key: 'all' });
  return opts;
}

function needsSiteStep(type: IntakeType, ctx: ContextPayload): boolean {
  return optionsFor(ctx, type).length > 1;
}
