'use client';

import * as React from 'react';
import { Bot, ChevronDown, RotateCcw, FileText } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { Button } from '@/components/ui/button';

interface ToolCall {
  id: string;
  tool: string;
  args: unknown;
  row_count: number | null;
  latency_ms: number | null;
  error: string | null;
  totals: unknown;
  label: unknown;
}
export interface TaskChat {
  state: string;
  /** The client has the portal open now; no email goes out for a staff reply. */
  client_present: boolean;
  email_hold_seconds: number;
  mode: string;
  handoff_note: { id: string; content: string } | null;
  attachments: Array<{ id: string; name: string; type: string; size: number; url: string }>;
  jobs: Array<{ id: string; status: string; gate_result: string | null; attempts: number }>;
  tool_calls: ToolCall[];
  cost_usd: number;
}

/** The drafted reply inside the handoff note: everything after "Draft reply (not sent...):". */
export function extractDraft(content: string): string | null {
  const m = content.match(/Draft reply \(not sent[^)]*\):\n([\s\S]*)$/);
  const draft = m?.[1]?.trim();
  return draft && draft !== '(none)' ? draft : null;
}

export function useTaskChat(taskId: string, opts: { live?: boolean } = {}) {
  return useQuery({
    queryKey: ['task-chat', taskId],
    queryFn: async () => {
      try {
        return await apiClient.get<TaskChat>(`/tasks/${taskId}/chat`);
      } catch {
        return null; // no conversation on this task
      }
    },
    retry: false,
    staleTime: 15_000,
    // The reply hint reads presence, so while it is on screen the answer is refreshed.
    refetchInterval: opts.live ? 20_000 : false,
  });
}

// Staff view of the portal chat on a task: where it stands, the data lookups the assistant made,
// the drafted reply (Use the draft fills "Reply to client"; nothing sends until Send), and Hand
// back to the assistant.
export function ChatStaffPanel({ taskId, onUseDraft }: { taskId: string; onUseDraft: (draft: string) => void }) {
  const { data } = useTaskChat(taskId);
  const qc = useQueryClient();
  const handBack = useMutation({
    mutationFn: () => apiClient.post(`/tasks/${taskId}/chat/hand-back`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-chat', taskId] });
      qc.invalidateQueries({ queryKey: ['comments'] });
    },
  });
  if (!data) return null;
  const draft = data.handoff_note ? extractDraft(data.handoff_note.content) : null;
  const withPerson = data.state === 'with_person';
  return (
    <div className="border-b border-border bg-surface-alt p-3 space-y-2" data-testid="chat-staff-panel">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Bot className="h-4 w-4 text-text-sub" aria-hidden="true" />
        <span className="font-medium text-text-main">Portal chat</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-surface-2 text-text-sub">{data.state.replace('_', ' ')}</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-surface-2 text-text-sub">{data.mode === 'tree' ? 'question steps' : 'assistant'}</span>
        <span className="text-xs text-text-sub">Cost ${data.cost_usd.toFixed(3)}</span>
      </div>
      {draft && (
        <div className="rounded border border-border bg-surface p-2 text-sm">
          <p className="text-xs text-text-sub mb-1">Drafted reply (not sent)</p>
          <p className="whitespace-pre-wrap break-words text-text-main">{draft}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => onUseDraft(draft)}>
            Use the draft
          </Button>
        </div>
      )}
      {withPerson && (
        <Button size="sm" variant="secondary" onClick={() => handBack.mutate()} disabled={handBack.isPending}>
          <RotateCcw className="h-3 w-3 mr-1" aria-hidden="true" />
          Hand back to the assistant
        </Button>
      )}
      {data.attachments.length > 0 && (
        <ul className="text-xs space-y-1">
          {data.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-1">
              <FileText className="h-3 w-3" aria-hidden="true" />
              <a className="text-primary underline" href={a.url} target="_blank" rel="noopener noreferrer">
                {a.name}
              </a>
            </li>
          ))}
        </ul>
      )}
      {data.tool_calls.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-text-sub inline-flex items-center gap-1">
            Data lookups ({data.tool_calls.length})
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </summary>
          <ul className="mt-1 space-y-1">
            {data.tool_calls.map((c) => (
              <li key={c.id} className="rounded bg-surface p-1.5 border border-border">
                <b>{c.tool}</b> {c.error ? <span className="text-red-600">failed: {c.error}</span> : null}
                <pre className="whitespace-pre-wrap break-words text-text-sub">{JSON.stringify(c.args)}</pre>
                {c.totals ? <pre className="whitespace-pre-wrap break-words text-text-sub">Totals {JSON.stringify(c.totals)}</pre> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
