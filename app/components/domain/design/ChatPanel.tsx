'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import type { ClientFileRef } from '@/lib/hooks/use-design-tray';
import type { BridgeDraft } from '@/lib/hooks/use-design-bridge';
import { deriveTimeline, isWorkerSilent, isSetupSlow } from '@/lib/design/feed-reducer';
import { getTerminology } from '@/lib/hooks/use-terminology';
import { useDesignFeedHistory } from '@/lib/hooks/use-design';
import { CostMeter } from './CostMeter';
import { EventItem } from './EventItem';
import { PlanChecklist } from './PlanChecklist';
import { SteeringInput, isClosedStatus } from './SteeringInput';

const num = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export interface ChatPanelProps {
  sessionId: string;
  /** Fallbacks for the first paint, before the feed answers. */
  initialStatus?: string;
  initialCost?: number | string;
  initialBudget?: number | string;
  /** When the session started, for the "pending for more than 60 s" check. */
  createdAt?: string | null;
  /** The one element selected on the preview, if any; it rides with the next message as a pin. */
  selection?: BridgeDraft | null;
  onClearSelection?: (id: string) => void;
  /** Client files attached in the Client files tab; they go with a message that has a selection. */
  attachedFiles?: ClientFileRef[];
  onDetachFile?: (id: string) => void;
  onSent?: () => void;
  /** The page being previewed, sent with every message. */
  view?: { path: string | null; width: number | null; previewSha?: string | null } | null;
}

export function ChatPanel({ sessionId, initialStatus = 'pending', initialCost = 0, initialBudget = 0, createdAt = null, selection = null, onClearSelection, attachedFiles, onDetachFile, onSent, view }: ChatPanelProps) {
  const history = useDesignFeedHistory(sessionId);
  const t = getTerminology().t;
  const latest = history.data?.latest;
  const state = history.data?.state;
  const status = latest?.status ?? initialStatus;

  // A 5 s tick keeps the silence check live between polls.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const [firstSeen] = React.useState(() => Date.now());
  const pendingSince = createdAt && Number.isFinite(Date.parse(createdAt)) ? Date.parse(createdAt) : firstSeen;
  const workerOnline = latest?.worker_online === true;
  const silent = !!latest && isWorkerSilent({ status, workerOnline, pendingSinceMs: pendingSince, now });
  const setupSlow = !!latest && isSetupSlow({ status, workerOnline, pendingSinceMs: pendingSince, now });

  const timeline = React.useMemo(() => (state ? deriveTimeline(state) : []), [state]);

  // Keep the newest line in view while the designer is at the bottom.
  const scroller = React.useRef<HTMLDivElement | null>(null);
  const stick = React.useRef(true);
  React.useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [timeline.length, latest?.live.text]);

  if (history.isLoading) return <Spinner />;
  if (history.error && !state) {
    return <p role="alert" className="text-sm text-text-sub">The chat could not be loaded. It will retry.</p>;
  }

  const liveText = latest?.live.text ?? null;
  const liveAction = latest?.live.action ?? null;

  return (
    <div className="flex min-h-[24rem] flex-col gap-3" data-testid="chat-panel">
      {silent && (
        <div role="status" data-testid="worker-silent" className="flex items-start gap-2 rounded-lg border border-border-warm px-3 py-2 text-sm" style={{ backgroundColor: 'var(--warning-subtle)', color: 'var(--warning)' }}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>The design worker has gone quiet. Your messages are saved and it will pick them up when it is back.</span>
        </div>
      )}
      {setupSlow && !silent && (
        <p role="status" data-testid="setup-slow" className="rounded-lg border border-border-warm px-3 py-2 text-sm text-text-sub">
          Setting up your preview (first build takes a few minutes)
        </p>
      )}
      <PlanChecklist items={state?.plan ?? null} />
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="max-h-[60vh] min-h-[12rem] flex-1 space-y-3 overflow-y-auto"
        role="log"
        aria-label="Activity"
      >
        {timeline.length === 0 && !liveText && !liveAction && (
          <p className="text-sm text-text-sub">Nothing here yet. Ask for a change, or pin something on the preview and press Apply. This {t('task').toLowerCase()} is yours until you close it.</p>
        )}
        {timeline.map((item) => <EventItem key={item.seq} sessionId={sessionId} item={item} />)}
        {(liveAction || liveText) && (
          <div className="space-y-1" data-testid="live-line" aria-live="polite">
            {liveAction && <p className="text-sm text-text-sub">{liveAction}</p>}
            {liveText && <p className="whitespace-pre-wrap break-words rounded-lg border border-dashed border-border-warm px-3 py-2 text-sm text-text-main">{liveText}</p>}
          </div>
        )}
      </div>
      <CostMeter
        sessionId={sessionId}
        costUsd={num(latest?.cost_usd ?? initialCost)}
        budgetUsd={num(latest?.budget_usd ?? initialBudget)}
        lastTurn={state?.lastTurn ?? null}
        canRaise={!isClosedStatus(status)}
        pausedForBudget={status === 'paused_budget'}
      />
      <SteeringInput sessionId={sessionId} status={status} selection={selection} onClearSelection={onClearSelection} attachedFiles={attachedFiles} onDetachFile={onDetachFile} onSent={onSent} view={view} />
    </div>
  );
}
