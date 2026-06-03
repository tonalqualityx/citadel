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
import type { Proposal, RunDetail } from '@/lib/types/troubador';

/**
 * Persistent action bar that always shows the current step and the button needed
 * to advance it, regardless of which tab is open. This is the single place a human
 * operates the run's gates (ready / selection_ready / interview complete).
 */
function StageActionBar({ run }: { run: RunDetail }) {
  const updateRun = useUpdateRun();
  const completeInterview = useCompleteInterview(run.id);
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
      message =
        'Run the interview with the client in the CLI, then mark it complete to start writing.';
      action = (
        <Button
          disabled={completeInterview.isPending}
          onClick={() => completeInterview.mutate(undefined)}
        >
          Mark interview complete
        </Button>
      );
      break;
    case 'in_production': {
      icon = <FileText className="h-5 w-5 text-emerald-500" />;
      const needsReview = run.article_stats?.in_review ?? 0;
      message =
        needsReview > 0
          ? `${needsReview} article${needsReview === 1 ? '' : 's'} awaiting your review — open the Articles tab.`
          : 'Review, approve, and schedule articles in the Articles tab.';
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
          <span className="text-text-main">{obj.question}</span>
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
        interview in the CLI. Use “Mark interview complete” above when you’re done.
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
