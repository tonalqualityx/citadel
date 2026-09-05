'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip } from '@/components/ui/tooltip';
import { useUpdateTask, type Task } from '@/lib/hooks/use-tasks';
import { usePostInternalComment } from '@/lib/hooks/use-post-internal-comment';
import { useCreateBlockerDismissal } from '@/lib/hooks/use-blocker-dismissals';
import { showToast } from '@/lib/hooks/use-toast';
import { formatRelativeTime } from '@/lib/utils/time';
import { apiClient } from '@/lib/api/client';
import { oracleProjectsKeys } from '@/lib/hooks/use-oracle-projects';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { KIND_HEADINGS } from './projects-logic';
import { NudgePanel, type NudgePanelOwner } from './NudgePanel';
import type { Blocker } from '@/lib/oracle/projects/blockers';

// The parking tag each reply-with-clear kind removes on a successful reply. Only
// decision/clarification have one — everything else's "reply" (when wired) is a plain
// comment with nothing to clear.
const PARKING_TAG_BY_KIND: Partial<Record<Blocker['kind'], string>> = {
  decision: 'needs-mike',
  clarification: 'awaiting-clarification',
};

// Phase 5 wired dismiss and nudge (someone_else / a non-Mike-owned client_approval).
// send_approval/mark_approved/resolve_ask/suspend, and nudge on stale/meeting_risk
// (no single resolvable owner — see the module doc comment below), are still deferred.
const COMING_NEXT_PASS = 'coming in the next pass';

// Phase 5 — nudge only has a clear, single, resolvable recipient for two kinds:
// someone_else (a real Citadel User, from Task.assignee_id) and a client_approval
// blocker the client themselves owns (a real ClientContact). stale/meeting_risk's
// 'nudge' action always carries owner=Mike (see blockers.ts) — there is no single
// obvious person to nudge about a stale PROJECT, so that stays deferred-with-tooltip.
function resolveNudgeOwner(blocker: Blocker): NudgePanelOwner | null {
  if (blocker.kind === 'someone_else') {
    return { kind: 'user', id: blocker.owner.id };
  }
  if (blocker.kind === 'client_approval' && !blocker.owner.is_mike) {
    return { kind: 'contact', id: blocker.owner.id };
  }
  return null;
}

interface BlockerRowProps {
  blocker: Blocker;
  projectId: string;
  onPick?: (blocker: Blocker) => void;
}

export function BlockerRow({ blocker, projectId, onPick }: BlockerRowProps) {
  const queryClient = useQueryClient();
  const [replyOpen, setReplyOpen] = React.useState(false);
  const [replyText, setReplyText] = React.useState('');
  const [changesOpen, setChangesOpen] = React.useState(false);
  const [changesText, setChangesText] = React.useState('');
  const [nudgeOpen, setNudgeOpen] = React.useState(false);

  const isTaskSourced = blocker.source.type === 'task';
  const taskId = isTaskSourced ? blocker.source.id : null;

  const { postInternalComment, isPending: commentPending } = usePostInternalComment(taskId ?? '');
  const updateTask = useUpdateTask();
  const createDismissal = useCreateBlockerDismissal(projectId);

  function invalidateProjects() {
    queryClient.invalidateQueries({ queryKey: oracleProjectsKeys.all });
  }

  async function submitReply() {
    if (!taskId || !replyText.trim()) return;
    const mentionBast = blocker.kind === 'decision' || blocker.kind === 'clarification';
    try {
      await postInternalComment({
        content: replyText.trim(),
        mentioned_user_ids: mentionBast ? [BAST_USER_ID] : [],
      });
      const parkingTag = PARKING_TAG_BY_KIND[blocker.kind];
      if (parkingTag) {
        // Fetched fresh at submit time (not from a separately-rendered `useTask` hook)
        // so this never races a slow initial task fetch — tags PATCH is full-replace,
        // so the current list has to be known right before the write, not at mount.
        const currentTask = await apiClient.get<Task>(`/tasks/${taskId}`);
        const nextTags = currentTask.tags.filter((t) => t !== parkingTag);
        await updateTask.mutateAsync({ id: taskId, data: { tags: nextTags } });
        showToast.success('Reply sent and tag cleared');
      } else {
        showToast.success('Reply sent');
      }
      setReplyText('');
      setReplyOpen(false);
      invalidateProjects();
    } catch {
      // usePostInternalComment/useUpdateTask already toast their own errors.
    }
  }

  async function approve() {
    if (!taskId) return;
    try {
      await updateTask.mutateAsync({ id: taskId, data: { approved: true } });
      invalidateProjects();
    } catch {
      // toasted by the hook
    }
  }

  async function submitRequestChanges() {
    if (!taskId || !changesText.trim()) return;
    try {
      await postInternalComment({ content: changesText.trim() });
      await updateTask.mutateAsync({ id: taskId, data: { approved: false } });
      showToast.success('Changes requested');
      setChangesText('');
      setChangesOpen(false);
      invalidateProjects();
    } catch {
      // toasted by the hooks
    }
  }

  async function dismiss() {
    if (!blocker.dismiss) return;
    try {
      await createDismissal.mutateAsync({
        kind: blocker.dismiss.kind,
        source_id: blocker.dismiss.source_id,
        source_marker: blocker.dismiss.source_marker,
      });
    } catch {
      // toasted by the hook
    }
  }

  const canReply = isTaskSourced && (blocker.actions.includes('reply') || false);
  const canApprove = isTaskSourced && blocker.actions.includes('approve');
  const canRequestChanges = isTaskSourced && blocker.actions.includes('request_changes');
  const canPick = blocker.actions.includes('pick');
  const canDismiss = blocker.actions.includes('dismiss') && !!blocker.dismiss;
  const nudgeOwner = blocker.actions.includes('nudge') ? resolveNudgeOwner(blocker) : null;
  const openLink =
    blocker.actions.includes('open_task') || blocker.actions.includes('open_email')
      ? blocker.source.url
      : null;
  const isExternalLink = openLink?.startsWith('http');

  const deferredActions = blocker.actions.filter(
    (a) =>
      (a === 'dismiss' && !canDismiss) ||
      (a === 'nudge' && !nudgeOwner) ||
      a === 'send_approval' ||
      a === 'mark_approved' ||
      a === 'resolve_ask' ||
      a === 'suspend' ||
      // Phase 5 tail fixes (MEDIUM-A) — the real, working version of these two lives in
      // ApprovalPanel.tsx (open the task, wait for the 30-minute gate to clear). This
      // row is the discovery surface, not a second implementation of the transition.
      a === 'mark_sent_manually' ||
      a === 'release_to_draft'
  );

  return (
    <div
      data-testid="blocker-row"
      data-kind={blocker.kind}
      className="flex flex-col gap-2 rounded-lg border px-3 py-2"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-sub">
              {KIND_HEADINGS[blocker.kind] ?? blocker.kind}
            </span>
            <span
              data-testid="blocker-owner"
              className="rounded-full border px-2 py-0.5 text-xs"
              style={
                blocker.owner.is_mike
                  ? { backgroundColor: 'var(--error-subtle)', color: 'var(--error)', borderColor: 'var(--error-subtle)' }
                  : { backgroundColor: 'var(--accent-subtle)', color: 'var(--text-main)', borderColor: 'var(--border)' }
              }
            >
              {blocker.owner.name}
            </span>
          </div>
          <div className="mt-1 text-sm text-text-main">{blocker.detail}</div>
          <div className="mt-1 text-xs text-text-sub">{formatRelativeTime(blocker.since)}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canReply && !replyOpen && (
          <Button size="sm" variant="secondary" onClick={() => setReplyOpen(true)}>
            {PARKING_TAG_BY_KIND[blocker.kind] ? 'Reply and clear' : 'Reply'}
          </Button>
        )}
        {canApprove && (
          <Button size="sm" variant="primary" onClick={approve} disabled={updateTask.isPending}>
            Approve
          </Button>
        )}
        {canRequestChanges && !changesOpen && (
          <Button size="sm" variant="secondary" onClick={() => setChangesOpen(true)}>
            Request changes
          </Button>
        )}
        {canPick && (
          <Button size="sm" variant="secondary" onClick={() => onPick?.(blocker)}>
            Pick
          </Button>
        )}
        {canDismiss && (
          <Button size="sm" variant="ghost" onClick={dismiss} disabled={createDismissal.isPending}>
            Dismiss
          </Button>
        )}
        {nudgeOwner && !nudgeOpen && (
          <Button size="sm" variant="ghost" onClick={() => setNudgeOpen(true)}>
            Nudge
          </Button>
        )}
        {openLink && (
          <Link
            href={openLink}
            target={isExternalLink ? '_blank' : undefined}
            rel={isExternalLink ? 'noopener noreferrer' : undefined}
            className="text-xs font-medium text-primary hover:underline"
          >
            Open
          </Link>
        )}
        {deferredActions.map((action) => (
          <Tooltip key={action} content={COMING_NEXT_PASS}>
            <button
              type="button"
              disabled
              title={COMING_NEXT_PASS}
              aria-label={`${deferredLabel(action)}, ${COMING_NEXT_PASS}`}
              className="cursor-not-allowed rounded-lg border px-3 py-1 text-xs font-medium text-text-sub opacity-50"
              style={{ borderColor: 'var(--border)' }}
            >
              {deferredLabel(action)}
            </button>
          </Tooltip>
        ))}
      </div>

      {canReply && replyOpen && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write a reply..."
            rows={2}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={submitReply} disabled={commentPending || !replyText.trim()}>
              {PARKING_TAG_BY_KIND[blocker.kind] ? 'Reply and clear' : 'Send reply'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReplyOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {canRequestChanges && changesOpen && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={changesText}
            onChange={(e) => setChangesText(e.target.value)}
            placeholder="What needs to change?"
            rows={2}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={submitRequestChanges} disabled={commentPending || !changesText.trim()}>
              Request changes
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setChangesOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {nudgeOwner && nudgeOpen && (
        <NudgePanel
          blockerId={blocker.id}
          projectId={projectId}
          owner={nudgeOwner}
          taskId={taskId}
          onClose={() => setNudgeOpen(false)}
        />
      )}
    </div>
  );
}

function deferredLabel(action: string): string {
  switch (action) {
    case 'dismiss':
      return 'Dismiss';
    case 'nudge':
      return 'Nudge';
    case 'send_approval':
      return 'Send for approval';
    case 'mark_approved':
      return 'Mark approved';
    case 'resolve_ask':
      return 'Resolve';
    case 'suspend':
      return 'Suspend';
    case 'mark_sent_manually':
      return 'Mark sent';
    case 'release_to_draft':
      return 'Release to draft';
    default:
      return action;
  }
}
