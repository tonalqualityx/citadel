'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  useTroubadorRun,
  useUpdateRun,
  useUpdateProposals,
} from '@/lib/hooks/use-troubador';
import { StageBadge } from '@/components/domain/troubador/StageBadge';
import { ArticleTable } from '@/components/domain/troubador/ArticleTable';
import type { Proposal, RunDetail } from '@/lib/types/troubador';

function BriefTab({ run }: { run: RunDetail }) {
  const updateRun = useUpdateRun();
  const [brief, setBrief] = React.useState(run.brief ?? '');
  const [goalType, setGoalType] = React.useState(run.goal_type ?? '');
  const [targetOffering, setTargetOffering] = React.useState(
    run.target_offering ?? ''
  );
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
      data: {
        brief,
        goal_type: goalType,
        target_offering: targetOffering,
        must_cover: mustCover,
        avoid,
      },
    });
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Textarea
        label="Brief"
        value={brief}
        rows={5}
        onChange={(e) => setBrief(e.target.value)}
      />
      <Input
        label="Goal type"
        value={goalType}
        onChange={(e) => setGoalType(e.target.value)}
      />
      <Input
        label="Target offering"
        value={targetOffering}
        onChange={(e) => setTargetOffering(e.target.value)}
      />
      <Textarea
        label="Must cover"
        value={mustCover}
        rows={3}
        onChange={(e) => setMustCover(e.target.value)}
      />
      <Textarea
        label="Avoid"
        value={avoid}
        rows={3}
        onChange={(e) => setAvoid(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={updateRun.isPending}>
          Save brief
        </Button>
        {run.stage === 'planning' && (
          <Button
            variant="secondary"
            disabled={updateRun.isPending || run.ready}
            onClick={() => updateRun.mutate({ id: run.id, data: { ready: true } })}
          >
            {run.ready ? 'Marked ready' : 'Mark ready'}
          </Button>
        )}
        {run.stage === 'topic_selection' && (
          <Button
            variant="secondary"
            disabled={updateRun.isPending || run.selection_ready}
            onClick={() =>
              updateRun.mutate({ id: run.id, data: { selection_ready: true } })
            }
          >
            {run.selection_ready ? 'Selection ready' : 'Selection ready'}
          </Button>
        )}
      </div>
    </div>
  );
}

function TopicsTab({ run }: { run: RunDetail }) {
  const updateProposals = useUpdateProposals(run.id);
  const [newTitle, setNewTitle] = React.useState('');
  const [newKeyword, setNewKeyword] = React.useState('');

  const toggleSelect = (p: Proposal) => {
    if (p.selected) {
      updateProposals.mutate({ deselect: [p.id] });
    } else {
      updateProposals.mutate({ select: [p.id] });
    }
  };

  const toggleSaveForLater = (p: Proposal) => {
    updateProposals.mutate({ save_for_later: [p.id] });
  };

  const addCustom = () => {
    const title = newTitle.trim();
    if (!title) return;
    updateProposals.mutate({
      add: [{ title, primary_keyword: newKeyword.trim() || undefined }],
    });
    setNewTitle('');
    setNewKeyword('');
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="space-y-2">
        {(run.proposals ?? []).length === 0 ? (
          <p className="text-sm text-text-sub">No proposed topics yet.</p>
        ) : (
          run.proposals.map((p) => (
            <div
              key={p.id}
              className="flex items-start gap-3 rounded-lg border border-border-warm bg-surface p-3"
            >
              <Checkbox
                checked={!!p.selected}
                onCheckedChange={() => toggleSelect(p)}
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-text-main">{p.title}</p>
                <div className="flex items-center gap-2 text-xs text-text-sub mt-0.5 flex-wrap">
                  {p.primary_keyword && <span>kw: {p.primary_keyword}</span>}
                  {p.archetype && <span>· {p.archetype}</span>}
                  {p.save_for_later && (
                    <span className="text-warning">· Saved for later</span>
                  )}
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
        <Input
          label="Title"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <Input
          label="Primary keyword (optional)"
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={addCustom}
            disabled={!newTitle.trim() || updateProposals.isPending}
          >
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
    return <p className="text-sm text-text-sub">No interview data yet.</p>;
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
          {obj.answer && (
            <span className="block text-text-sub mt-0.5">{obj.answer}</span>
          )}
        </li>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-text-sub">
        Status:{' '}
        <span className="text-text-main">{interview.status ?? 'unknown'}</span>
      </p>
      {Array.isArray(questions) && questions.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-text-sub mb-2">
            Questions
          </h4>
          <ul className="space-y-2 list-disc pl-5">
            {questions.map(renderQuestion)}
          </ul>
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
      <div className="text-center py-12 text-text-sub text-sm">
        Failed to load run.
      </div>
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
