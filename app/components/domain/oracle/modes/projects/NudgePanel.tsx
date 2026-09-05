'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useNudgeDraft, type NudgeDraft } from '@/lib/hooks/use-nudge-draft';
import { usePostInternalComment } from '@/lib/hooks/use-post-internal-comment';
import { showToast } from '@/lib/hooks/use-toast';

export interface NudgePanelOwner {
  kind: 'user' | 'contact' | 'label';
  id?: string;
  label?: string;
}

interface NudgePanelProps {
  blockerId: string;
  projectId: string;
  owner: NudgePanelOwner;
  // Present only when the blocker is task-sourced — required to post a comment; not
  // needed for the email channel (Mike opens Gmail himself, nothing is posted here).
  taskId: string | null;
  // Collapses the panel back to its "Nudge" trigger button, in the caller
  // (BlockerRow keeps that toggle state, not this component).
  onClose?: () => void;
}

// Oracle Projects Tab Phase 5 — a drafted nudge, keyed off who owns the blocker.
// POST /api/oracle/projects/nudge-draft never sends anything; this component's own
// actions are the only things that move: "Post comment" (through the internal-comment
// helper, is_internal:true) for a Citadel user, or "Open in Gmail" (a plain mailto:
// link — queues nothing, Mike sends it himself) for a client contact or a label-only
// owner with no record.
export function NudgePanel({ blockerId, projectId, owner, taskId, onClose }: NudgePanelProps) {
  const [draft, setDraft] = React.useState<NudgeDraft | null>(null);
  const draftNudge = useNudgeDraft();
  const { postInternalComment, isPending: postingComment } = usePostInternalComment(taskId ?? '');

  async function fetchDraft() {
    const ownerPayload =
      owner.kind === 'user'
        ? { user_id: owner.id }
        : owner.kind === 'contact'
          ? { contact_id: owner.id }
          : { label: owner.label };
    try {
      const result = await draftNudge.mutateAsync({ blocker_id: blockerId, project_id: projectId, owner: ownerPayload });
      setDraft(result);
    } catch {
      // toasted by the hook
    }
  }

  async function postComment() {
    if (!draft || !taskId) return;
    try {
      await postInternalComment({
        content: draft.body,
        mentioned_user_ids: owner.kind === 'user' && owner.id ? [owner.id] : [],
      });
      showToast.success('Comment posted');
      setDraft(null);
      onClose?.();
    } catch {
      // toasted by the hook
    }
  }

  const mailtoHref = draft
    ? `mailto:${encodeURIComponent(draft.to)}?subject=${encodeURIComponent(draft.subject ?? '')}&body=${encodeURIComponent(draft.body)}`
    : '#';

  if (!draft) {
    return (
      <Button size="sm" variant="secondary" onClick={fetchDraft} disabled={draftNudge.isPending}>
        Draft a nudge
      </Button>
    );
  }

  return (
    <div data-testid="nudge-panel" className="flex flex-col gap-2 rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
      {draft.channel === 'email' && (
        <p className="text-xs text-text-sub">To: {draft.to || 'add an address before sending'}</p>
      )}
      {draft.subject && <p className="text-sm font-medium text-text-main">{draft.subject}</p>}
      <p className="whitespace-pre-wrap text-sm text-text-main">{draft.body}</p>
      <div className="flex gap-2">
        {draft.channel === 'comment' ? (
          <Button size="sm" variant="primary" onClick={postComment} disabled={postingComment}>
            Post comment
          </Button>
        ) : (
          <Button size="sm" variant="primary" asChild>
            <a href={mailtoHref}>Open in Gmail</a>
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft(null);
            onClose?.();
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
