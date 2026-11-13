'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useComments, commentKeys } from '@/lib/hooks/use-comments';
import { postHomeAct, useHomeUndo, HOME_FAILURE_TEXT } from '@/lib/hooks/use-home';
import { showToast } from '@/lib/hooks/use-toast';
import { taskKeys } from '@/lib/api/query-keys';
import { LOOKS_DONE_HEADING, LOOKS_DONE_NO_NOTE, TRIAGE_BUTTONS } from '@/lib/tasks/triage-copy';
import { LOOKS_DONE_TAG, evidenceOf, evidenceParts } from '@/lib/tasks/looks-done';

/**
 * The task page for a Triage card an agent marked `triage:looks-done`: the evidence line (links clickable) and the two owner buttons,
 * Close as done and Not done. Renders nothing unless the card is in Triage, carries the mark, and the viewer is the owner (the
 * caller passes `isOwner`; the server refuses anyone else anyway). Each tap is the same home act the Triage section uses, with Undo.
 */
export function TaskLooksDone({ taskId, status, tags, isOwner }: { taskId: string; status: string; tags: string[]; isOwner: boolean }) {
  const show = isOwner && status === 'triage' && tags.includes(LOOKS_DONE_TAG);
  const { data } = useComments(taskId, { enabled: show });
  const queryClient = useQueryClient();
  const undo = useHomeUndo();
  const [working, setWorking] = React.useState(false);
  if (!show) return null;

  const newest = [...(data?.comments ?? [])]
    .filter((c) => c.is_internal && !c.client_visible)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((c) => evidenceOf(c.content))
    .find((e): e is string => e !== null);

  const act = async (action: 'triage_close_done' | 'triage_not_done') => {
    setWorking(true);
    try {
      const res = await postHomeAct({ action, task_ids: [taskId] });
      showToast.success(res.message ?? 'Done.', res.undo_until ? { action: { label: 'Undo', onClick: () => void undo(res.action_id) }, duration: 10_000 } : undefined);
      await Promise.all([queryClient.invalidateQueries({ queryKey: taskKeys.all }), queryClient.invalidateQueries({ queryKey: commentKeys.task(taskId) }), queryClient.invalidateQueries({ queryKey: ['home'] })]);
    } catch (e) {
      showToast.error(e instanceof Error && e.message ? e.message : HOME_FAILURE_TEXT);
    } finally {
      setWorking(false);
    }
  };

  return (
    <Card data-testid="task-looks-done">
      <CardContent className="space-y-3 py-4">
        <p className="text-sm font-medium">{LOOKS_DONE_HEADING}</p>
        <p className="text-sm" data-testid="task-looks-done-evidence">
          {newest
            ? evidenceParts(newest).map((p, i) =>
                p.href ? (
                  <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="underline">
                    {p.text}
                  </a>
                ) : (
                  <React.Fragment key={i}>{p.text}</React.Fragment>
                ),
              )
            : LOOKS_DONE_NO_NOTE}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={working} onClick={() => void act('triage_close_done')}>
            {TRIAGE_BUTTONS.closeDone}
          </Button>
          <Button variant="secondary" disabled={working} onClick={() => void act('triage_not_done')}>
            {TRIAGE_BUTTONS.notDone}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
