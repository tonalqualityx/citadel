'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ChoiceList } from './choice-list';
import { ChatBubble } from './chat-bubble';
import { SoFarPanel } from './so-far-panel';
import { StepMeter } from './step-meter';
import { PortalButton } from '@/components/portal/ui/button';
import { Callout } from '@/components/portal/ui/callout';
import { Skeleton, SkeletonRegion } from '@/components/portal/ui/skeleton';
import { IntakeStep, type StepAnswer, type StepSpec } from './intake-step';
import { IntakeSummary } from './intake-summary';
import {
  ALL_SITES_LABEL,
  ANSWER_MAX,
  BUTTONS,
  NO_PERMISSION_MESSAGE,
  OPENING_CHOICES,
  OPENING_PROMPT,
  SENT_DOWNGRADED,
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

export function IntakeChat({ initialText, carriedFiles }: { initialText?: string; carriedFiles?: number } = {}) {
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
  if (loadError) {
    return (
      <Callout tone="urgent" icon={TriangleAlert} title="We could not load this page" id="intake-load">
        <p>{loadError}</p>
      </Callout>
    );
  }
  if (!ctx) {
    return (
      <SkeletonRegion label="Loading the request chat">
        <div className="chatwrap">
          <div className="chatcard">
            <Skeleton lines={2} block />
          </div>
          <div className="sofar desk">
            <Skeleton lines={3} />
          </div>
        </div>
      </SkeletonRegion>
    );
  }
  if (!ctx.can_request) {
    return (
      <div className="card">
        <p>{NO_PERMISSION_MESSAGE}</p>
      </div>
    );
  }

  // What has been said so far, oldest first. Each answer can be changed.
  const transcript: Array<{ key: string; label: string; prompt: string; answer: string; change: () => void }> = [];
  if (type && phase !== 'type') {
    transcript.push({ key: 'type', label: 'What you need', prompt: OPENING_PROMPT, answer: typeLabel(type), change: () => setPhase('type') });
    if (phase !== 'site' && siteOptions.length > 1 && selection.siteName) {
      transcript.push({ key: 'site', label: 'Site', prompt: SITE_PROMPT, answer: selection.siteName, change: () => setPhase('site') });
    }
    stepSpecs.forEach((s, i) => {
      if (phase === 'q' && i >= qIndex) return;
      const t = answerText(answers[s.id], s.choices);
      if (t)
        transcript.push({
          key: s.id,
          label: s.prompt,
          prompt: s.prompt,
          answer: t,
          change: () => {
            setQIndex(i);
            setPhase('q');
          },
        });
    });
  }

  const placement = summary;
  const projectChoices = placement && !placement.ok ? placement.candidates.map((c) => ({ id: c.id, name: c.name })) : null;
  const okPlacement = placement && placement.ok ? placement : null;
  const projectName = okPlacement?.project_id ? ctx.open_builds.find((b) => b.id === okPlacement.project_id)?.name : null;
  const planName = okPlacement?.charter_id ? ctx.charters.find((c) => c.id === okPlacement.charter_id)?.label : null;
  const destination =
    okPlacement && (phase === 'summary' || siteSel !== null)
      ? destinationLine({ chain: okPlacement.chain, project_name: projectName, plan_name: planName, site_name: selection.siteName })
      : '';

  const stage: 0 | 1 | 2 | 3 = phase === 'type' ? 0 : phase === 'site' ? 1 : phase === 'q' ? 2 : 3;
  const meter = (
    <StepMeter stage={stage} question={phase === 'q' ? qIndex + 1 : undefined} total={Math.max(1, stepSpecs.length)} sent={phase === 'sent'} />
  );

  if (phase === 'sent' && sent) {
    return (
      <>
        {meter}
        <section className="summary-card" aria-live="polite">
          <h2 id="intake-sent-heading">{SENT_HEADING}</h2>
          {sent.urgent && <p className="strong">{SENT_URGENT}</p>}
          {/* They asked for urgent but the daily limit meant no alert: do not say the team was alerted. */}
          {!sent.urgent && urgent && <p>{SENT_DOWNGRADED}</p>}
          <div className="actions">
            <PortalButton href={`/portal/work/${sent.id}`}>{SENT_LINK_LABEL}</PortalButton>
          </div>
        </section>
      </>
    );
  }

  const currentPrompt =
    phase === 'type' ? OPENING_PROMPT : phase === 'site' ? SITE_PROMPT : phase === 'q' && stepSpecs[qIndex] ? stepSpecs[qIndex].prompt : null;
  const sofarRows = transcript.map((t) => ({ label: t.label, value: t.answer }));
  const inSummary = phase === 'summary';

  return (
    <>
      {meter}
      {initialText ? (
        <div className="card carried" data-testid="intake-carried">
          <p className="strong">What you wrote is kept:</p>
          <p className="pre">{initialText}</p>
          {carriedFiles ? <p className="meta">Your files were not sent. You can attach them in the conversation once the request is sent.</p> : null}
        </div>
      ) : null}
      <div className="chatwrap">
        <section className="chatcard" aria-label="Request chat">
          {/* The summary repeats every answer, so the log and the side panel step aside for it. */}
          {!inSummary && <SoFarPanel mode="phone" rows={sofarRows} destination={destination || null} />}
          {!inSummary && (
            <div className="log" role="log" aria-live="polite" aria-label="Conversation">
              {transcript.map((t) => (
                <Fragment key={t.key}>
                  <ChatBubble side="us" who="Indelible">
                    {t.prompt}
                  </ChatBubble>
                  <ChatBubble side="you" who="You" onChange={t.change} changeLabel={t.prompt}>
                    <span className="pre">{t.answer}</span>
                  </ChatBubble>
                </Fragment>
              ))}
              {currentPrompt && (
                <ChatBubble side="us" who="Indelible" current>
                  {currentPrompt}
                </ChatBubble>
              )}
            </div>
          )}

          {phase === 'type' && (
            <div className="composer">
              <ChoiceList
                name="intake-type"
                label={OPENING_PROMPT}
                options={OPENING_CHOICES}
                value={type}
                onChange={(k) => isIntakeType(k) && pickType(k)}
              />
              <p className="hint">You can change any answer before you send.</p>
            </div>
          )}

          {phase === 'site' && (
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                if (siteSel) setPhase('q');
              }}
            >
              <ChoiceList name="intake-site" label={SITE_PROMPT} options={siteOptions} value={siteSel} onChange={setSiteSel} />
              <div className="actions">
                <PortalButton type="submit" disabled={!siteSel}>
                  {BUTTONS.next}
                </PortalButton>
                <PortalButton variant="quiet" icon={ArrowLeft} onClick={goBack}>
                  {BUTTONS.back}
                </PortalButton>
              </div>
              <p className="hint">You can change any answer before you send.</p>
            </form>
          )}

          {phase === 'q' && stepSpecs[qIndex] && (
            <IntakeStep
              key={`${type}-${stepSpecs[qIndex].id}-${qIndex}`}
              step={stepSpecs[qIndex]}
              initial={
                answers[stepSpecs[qIndex].id] ??
                // Words typed in the chat before it fell back to these steps go into the first free-text answer.
                (initialText && !stepSpecs[qIndex].choices && !stepSpecs.slice(0, qIndex).some((s) => !s.choices) ? { value: initialText.slice(0, ANSWER_MAX) } : undefined)
              }
              canGoBack
              onBack={goBack}
              onSubmit={(a) => submitQuestion(qIndex, a)}
            />
          )}

          {inSummary && type && (
            <IntakeSummary
              typeLabel={typeLabel(type)}
              siteName={selection.siteName}
              answers={questions
                .filter((q) => answers[q.key])
                .map((q) => ({ prompt: q.prompt, value: answerText(answers[q.key], stepSpecs.find((s) => s.id === q.key)?.choices) }))}
              destination={destination}
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
        </section>
        {!inSummary && <SoFarPanel mode="desk" rows={sofarRows} destination={destination || null} />}
      </div>
    </>
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
