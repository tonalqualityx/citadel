'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Plus, CheckCircle2, Clock, Mic, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils/cn';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  useTroubadorRun,
  useUpdateRun,
  useUpdateProposals,
  useCompleteInterview,
} from '@/lib/hooks/use-troubador';
import { StageBadge } from '@/components/domain/troubador/StageBadge';
import { ArticleTable } from '@/components/domain/troubador/ArticleTable';
import type { InterviewAnswer, Proposal, RunDetail } from '@/lib/types/troubador';

/**
 * Persistent action bar that always shows the current step and the button needed
 * to advance it, regardless of which tab is open. This is the single place a human
 * operates the run's gates (ready / selection_ready / interview complete).
 */
function StageActionBar({ run }: { run: RunDetail }) {
  const updateRun = useUpdateRun();
  const selectedCount = (run.proposals ?? []).filter((p) => p.selected).length;

  let icon = <FileText className="h-5 w-5" />;
  let tone = 'border-border-warm bg-surface';
  let message: React.ReactNode = null;
  let action: React.ReactNode = null;

  switch (run.stage) {
    case 'planning':
      icon = <FileText className="h-5 w-5 text-amber-500" />;
      if (run.ready) {
        message = '✓ Marked ready. The worker will propose topics on its next run.';
      } else {
        message = 'Add a brief, then mark this run ready — the worker will propose topics.';
        action = (
          <Button
            disabled={updateRun.isPending}
            onClick={() => updateRun.mutate({ id: run.id, data: { ready: true } })}
          >
            Mark ready
          </Button>
        );
      }
      break;
    case 'topic_selection':
      icon = <CheckCircle2 className="h-5 w-5 text-sky-500" />;
      if (run.selection_ready) {
        message = '✓ Selection locked. The worker will create articles and start research.';
      } else {
        message = `Pick the topics to write (${selectedCount} selected), then lock the selection.`;
        action = (
          <Button
            disabled={updateRun.isPending || selectedCount === 0}
            onClick={() =>
              updateRun.mutate({ id: run.id, data: { selection_ready: true } })
            }
          >
            Selection ready{selectedCount ? ` (${selectedCount})` : ''}
          </Button>
        );
      }
      break;
    case 'researching':
      icon = <Clock className="h-5 w-5 text-violet-500" />;
      message = '⏳ The worker is researching the selected topics.';
      break;
    case 'ready_for_interview':
      icon = <Mic className="h-5 w-5 text-fuchsia-500" />;
      // No human button here by design: Troubador runs the interview in the CLI and
      // marks it complete itself when the conversation wraps (advancing to writing).
      message =
        'Prep questions are ready. Run the interview with the client in the CLI — Troubador will mark it complete and start writing when you finish.';
      break;
    case 'in_production': {
      icon = <FileText className="h-5 w-5 text-emerald-500" />;
      const needsReview = run.article_stats?.in_review ?? 0;
      message =
        needsReview > 0
          ? `${needsReview} article${needsReview === 1 ? '' : 's'} awaiting your review — open the Articles tab.`
          : 'Review and approve articles in the Articles tab. The run moves to Publishing once they’re all approved.';
      break;
    }
    case 'publishing': {
      icon = <CheckCircle2 className="h-5 w-5 text-sky-500" />;
      tone = 'border-sky-500/30 bg-sky-500/5';
      const scheduled = run.article_stats?.scheduled ?? 0;
      const approved = run.article_stats?.approved ?? 0;
      message =
        `All articles approved — set publish dates in the Articles tab` +
        (approved > 0 ? ` (${approved} not yet scheduled).` : '.') +
        ' Publishing itself runs via the Bast cron.';
      void scheduled;
      break;
    }
    case 'done':
      icon = <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
      tone = 'border-emerald-500/30 bg-emerald-500/5';
      message = '✓ All articles published. This run is done.';
      break;
    case 'cancelled':
      message = 'This run was cancelled.';
      break;
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 rounded-lg border p-4 flex-wrap',
        tone
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon}
        <p className="text-sm text-text-main">{message}</p>
      </div>
      {action}
    </div>
  );
}

function BriefTab({ run }: { run: RunDetail }) {
  const updateRun = useUpdateRun();
  const [brief, setBrief] = React.useState(run.brief ?? '');
  const [goalType, setGoalType] = React.useState(run.goal_type ?? '');
  const [targetOffering, setTargetOffering] = React.useState(run.target_offering ?? '');
  const [mustCover, setMustCover] = React.useState(run.must_cover ?? '');
  const [avoid, setAvoid] = React.useState(run.avoid ?? '');

  React.useEffect(() => {
    setBrief(run.brief ?? '');
    setGoalType(run.goal_type ?? '');
    setTargetOffering(run.target_offering ?? '');
    setMustCover(run.must_cover ?? '');
    setAvoid(run.avoid ?? '');
  }, [run]);

  const handleSave = () => {
    updateRun.mutate({
      id: run.id,
      data: { brief, goal_type: goalType, target_offering: targetOffering, must_cover: mustCover, avoid },
    });
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Textarea label="Brief" value={brief} rows={5} onChange={(e) => setBrief(e.target.value)} />
      <Input label="Goal type" value={goalType} onChange={(e) => setGoalType(e.target.value)} />
      <Input
        label="Target offering"
        value={targetOffering}
        onChange={(e) => setTargetOffering(e.target.value)}
      />
      <Textarea label="Must cover" value={mustCover} rows={3} onChange={(e) => setMustCover(e.target.value)} />
      <Textarea label="Avoid" value={avoid} rows={3} onChange={(e) => setAvoid(e.target.value)} />
      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={updateRun.isPending}>
          Save brief
        </Button>
      </div>
    </div>
  );
}

function TopicsTab({ run }: { run: RunDetail }) {
  const updateProposals = useUpdateProposals(run.id);
  const [newTitle, setNewTitle] = React.useState('');
  const [newKeyword, setNewKeyword] = React.useState('');

  const toggleSelect = (p: Proposal) => {
    updateProposals.mutate(p.selected ? { deselect: [p.id] } : { select: [p.id] });
  };
  const toggleSaveForLater = (p: Proposal) => {
    updateProposals.mutate({ save_for_later: [p.id] });
  };
  const addCustom = () => {
    const title = newTitle.trim();
    if (!title) return;
    updateProposals.mutate({ add: [{ title, primary_keyword: newKeyword.trim() || undefined }] });
    setNewTitle('');
    setNewKeyword('');
  };

  const selectedCount = (run.proposals ?? []).filter((p) => p.selected).length;

  return (
    <div className="space-y-4 max-w-2xl">
      {(run.proposals ?? []).length > 0 && (
        <p className="text-sm text-text-sub">
          <span className="font-medium text-text-main">{selectedCount}</span> of{' '}
          {run.proposals.length} topics marked to write.
        </p>
      )}
      <div className="space-y-2">
        {(run.proposals ?? []).length === 0 ? (
          <p className="text-sm text-text-sub">No proposed topics yet.</p>
        ) : (
          run.proposals.map((p) => (
            <div
              key={p.id}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                p.selected
                  ? 'border-primary bg-primary/5'
                  : 'border-border-warm bg-surface'
              )}
            >
              <Checkbox checked={!!p.selected} onCheckedChange={() => toggleSelect(p)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-text-main">{p.title}</p>
                  {p.selected && (
                    <Badge variant="success" size="sm">
                      ✓ Will write
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-text-sub mt-0.5 flex-wrap">
                  {p.primary_keyword && <span>kw: {p.primary_keyword}</span>}
                  {p.archetype && <span>· {p.archetype}</span>}
                  {p.save_for_later && <span className="text-warning">· Saved for later</span>}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => toggleSaveForLater(p)}
                disabled={updateProposals.isPending}
              >
                {p.save_for_later ? 'Unsave' : 'Save for later'}
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="rounded-lg border border-border-warm p-3 space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-text-sub">
          Add custom topic
        </h4>
        <Input label="Title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
        <Input
          label="Primary keyword (optional)"
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={addCustom} disabled={!newTitle.trim() || updateProposals.isPending}>
            <Plus className="h-4 w-4" /> Add topic
          </Button>
        </div>
      </div>
    </div>
  );
}

function questionLabel(q: unknown, i: number): string {
  if (typeof q === 'string') return q;
  if (q && typeof q === 'object' && 'question' in (q as Record<string, unknown>)) {
    const obj = q as { question?: string };
    return obj.question || `Question ${i + 1}`;
  }
  return `Question ${i + 1}`;
}

/** Read-only display of client-written prep answers from the portal (Interview.answers). */
function ClientAnswers({ answers }: { answers: InterviewAnswer[] }) {
  return (
    <div className="rounded-lg border border-border-warm bg-surface p-3 space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-sub">
        Client written answers (from the portal)
      </h4>
      <ul className="space-y-2">
        {answers.map((a, i) => (
          <li key={i} className="text-sm">
            {a.question && <span className="block text-text-sub">{a.question}</span>}
            <span className="block text-text-main whitespace-pre-line">{a.answer}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Additional, human-driven path to complete the interview: paste (or load a .txt/.md file
 * into) a transcript and submit it to the SAME interview-complete route the Troubador CLI
 * skill calls. Only shown while ready_for_interview and the interview isn't already
 * complete. Advancing the run to in_production this way cannot be undone from the UI, so
 * it's confirmed first. Any client-written answers are auto-appended to the transcript
 * payload (clearly delimited) so the worker's transcript-mining picks them up too.
 */
function TranscriptCompletion({ run }: { run: RunDetail }) {
  const completeInterview = useCompleteInterview();
  const [transcript, setTranscript] = React.useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const answers = (run.interview?.answers ?? []) as InterviewAnswer[];

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setTranscript(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.readAsText(file);
    // Allow re-selecting the same file later.
    e.target.value = '';
  }

  function buildPayload(): string {
    if (answers.length === 0) return transcript;
    const answersBlock = answers
      .map((a) => `${a.question ? `Q: ${a.question}\n` : ''}A: ${a.answer}`)
      .join('\n\n');
    return `${transcript}\n\n--- CLIENT WRITTEN ANSWERS (portal) ---\n${answersBlock}`;
  }

  function handleSubmit() {
    if (!transcript.trim()) return;
    if (
      !confirm(
        'Complete this interview with the pasted transcript? This advances the run to In Production and cannot be undone from the UI.'
      )
    ) {
      return;
    }
    completeInterview.mutate({ id: run.id, transcript: buildPayload() });
  }

  return (
    <div className="rounded-lg border border-border-warm p-3 space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-sub">
        Complete interview with transcript
      </h4>
      <p className="text-xs text-text-sub">
        Paste the interview transcript, or load a .txt/.md file. This is an additional path to
        the CLI-driven interview — submitting advances the run to In Production.
        {answers.length > 0 &&
          ' Client-written answers above will be appended automatically.'}
      </p>
      <Textarea
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        rows={8}
        placeholder="Paste the transcript here…"
      />
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          className="hidden"
          onChange={handleFileChosen}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
        >
          Load .txt/.md file
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!transcript.trim() || completeInterview.isPending}
          onClick={handleSubmit}
        >
          {completeInterview.isPending ? 'Completing…' : 'Complete interview'}
        </Button>
      </div>
    </div>
  );
}

function InterviewTab({ run }: { run: RunDetail }) {
  const interview = run.interview;
  if (!interview) {
    return (
      <p className="text-sm text-text-sub">
        No interview yet — the worker posts prep questions once research is done.
      </p>
    );
  }

  const questions = interview.questions;
  const answers = (interview.answers ?? []) as InterviewAnswer[];
  const renderQuestion = (q: unknown, i: number) => {
    if (typeof q === 'string') {
      return (
        <li key={i} className="text-sm text-text-main">
          {q}
        </li>
      );
    }
    if (q && typeof q === 'object') {
      const obj = q as { question?: string; answer?: string };
      return (
        <li key={i} className="text-sm">
          <span className="text-text-main">{obj.question ?? questionLabel(q, i)}</span>
          {obj.answer && <span className="block text-text-sub mt-0.5">{obj.answer}</span>}
        </li>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-text-sub">
        Status: <span className="text-text-main">{interview.status ?? 'unknown'}</span>
      </p>
      <p className="text-xs text-text-sub">
        These questions are prep material — email them to the client, then run the live
        interview in the CLI. Troubador marks the interview complete and starts writing
        automatically when the conversation wraps.
      </p>
      {Array.isArray(questions) && questions.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-text-sub mb-2">
            Questions
          </h4>
          <ul className="space-y-2 list-disc pl-5">{questions.map(renderQuestion)}</ul>
        </div>
      ) : (
        <p className="text-sm text-text-sub">No interview questions yet.</p>
      )}

      {answers.length > 0 && <ClientAnswers answers={answers} />}

      {run.stage === 'ready_for_interview' && interview.status !== 'complete' && (
        <TranscriptCompletion run={run} />
      )}
    </div>
  );
}

export default function RunDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const { data: run, isLoading, isError } = useTroubadorRun(id);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="md" />
      </div>
    );
  }

  if (isError || !run) {
    return (
      <div className="text-center py-12 text-text-sub text-sm">Failed to load run.</div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/troubador"
          className="inline-flex items-center gap-1 text-sm text-text-sub hover:text-text-main transition-colors mb-2"
        >
          <ArrowLeft className="h-4 w-4" /> Board
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-text-main">{run.title}</h1>
              <StageBadge stage={run.stage} />
            </div>
            <p className="text-sm text-text-sub mt-1">
              {run.client?.name} · {run.site?.name}
              {run.assignee ? ` · ${run.assignee.name}` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Always-visible current-step + action */}
      <StageActionBar run={run} />

      <Tabs defaultValue="brief">
        <TabsList>
          <TabsTrigger value="brief">Brief</TabsTrigger>
          <TabsTrigger value="topics">Topics</TabsTrigger>
          <TabsTrigger value="articles">Articles</TabsTrigger>
          <TabsTrigger value="interview">Interview</TabsTrigger>
        </TabsList>

        <TabsContent value="brief" className="pt-4">
          <BriefTab run={run} />
        </TabsContent>
        <TabsContent value="topics" className="pt-4">
          <TopicsTab run={run} />
        </TabsContent>
        <TabsContent value="articles" className="pt-4">
          <ArticleTable articles={run.articles ?? []} />
        </TabsContent>
        <TabsContent value="interview" className="pt-4">
          <InterviewTab run={run} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
