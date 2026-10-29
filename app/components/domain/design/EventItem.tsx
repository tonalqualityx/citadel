'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { RESULT_DETAIL_LINES, isReportOnlyGate, type GateRow, type TimelineItem } from '@/lib/design/feed-reducer';

export const assetUrl = (sessionId: string, assetId: string) => `/api/design/sessions/${sessionId}/assets/${assetId}`;

function GateCard({ sessionId, item }: { sessionId: string; item: Extract<TimelineItem, { type: 'gate' }> }) {
  const failedGates = item.gates.filter((g) => !g.ok && !isReportOnlyGate(g.name));
  const reported = item.gates.filter((g) => !g.ok && isReportOnlyGate(g.name));
  const names = item.gates.map((g) => (isReportOnlyGate(g.name) ? `${g.name} (report only)` : g.name)).join(', ');

  // A run with nothing red is one compact line that expands to the per-gate details.
  if (failedGates.length === 0) {
    return (
      <details className="rounded-lg border border-border-warm bg-surface px-3 py-2 text-sm" data-testid="gate-summary">
        <summary className="flex cursor-pointer items-center gap-2 text-text-main">
          <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: 'var(--success)' }} aria-hidden="true" />
          <span className="min-w-0">Checks passed: {names}{reported.length > 0 ? `. ${reported.map((g) => g.name).join(', ')} reported findings.` : ''}</span>
        </summary>
        <ul className="mt-2 space-y-1">
          {item.gates.map((g) => <GateLine key={g.name} sessionId={sessionId} gate={g} />)}
        </ul>
      </details>
    );
  }
  return (
    <div className="rounded-lg border border-border-warm bg-surface px-3 py-2" data-testid="gate-card">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium text-text-main">
        <AlertTriangle className="h-4 w-4" style={{ color: 'var(--warning)' }} aria-hidden="true" />
        {`${failedGates.length} of ${item.gates.length} gates failed`}
        {item.blocking && <Badge variant="warning" size="sm">Blocks publishing</Badge>}
      </div>
      <ul className="space-y-1">
        {item.gates.map((g) => <GateLine key={g.name} sessionId={sessionId} gate={g} />)}
      </ul>
    </div>
  );
}

function GateLine({ sessionId, gate }: { sessionId: string; gate: GateRow }) {
  const [open, setOpen] = React.useState(false);
  const [output, setOutput] = React.useState<string | null>(null);
  const [error, setError] = React.useState(false);
  const expandable = !!gate.log_asset_id;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && output === null && gate.log_asset_id) {
      try {
        const res = await fetch(assetUrl(sessionId, gate.log_asset_id), { credentials: 'same-origin' });
        if (!res.ok) throw new Error('bad status');
        setOutput(await res.text());
      } catch {
        setError(true);
      }
    }
  };

  return (
    <li className="text-sm">
      <div className="flex items-start gap-2">
        {gate.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--success)' }} aria-hidden="true" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--error)' }} aria-hidden="true" />}
        <span className="min-w-0 flex-1">
          <span className="font-medium text-text-main">{gate.name}</span>
          <span className="sr-only">{gate.ok ? ' passed' : ' failed'}</span>
          {gate.summary && <span className="text-text-sub">: {gate.summary}</span>}
        </span>
        {expandable && (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className="inline-flex min-h-[44px] items-center gap-1 text-xs text-primary hover:underline sm:min-h-0"
          >
            {open ? <ChevronDown className="h-3 w-3" aria-hidden="true" /> : <ChevronRight className="h-3 w-3" aria-hidden="true" />}
            Output<span className="sr-only"> for {gate.name}</span>
          </button>
        )}
      </div>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto rounded border border-border-warm bg-background-light p-2 text-xs text-text-main" data-testid="gate-output">
          {error ? 'The output could not be loaded.' : output ?? 'Loading...'}
        </pre>
      )}
    </li>
  );
}

function ToolLine({ item }: { item: Extract<TimelineItem, { type: 'tool' }> }) {
  const lines = item.details ? item.details.split('\n') : [];
  const shown = lines.slice(0, RESULT_DETAIL_LINES);
  return (
    <div className="text-sm text-text-sub" data-testid="tool-line" data-state={item.state}>
      <div className="flex items-start gap-2">
        {item.state === 'running' && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
        {item.state === 'ok' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--success)' }} aria-hidden="true" />}
        {item.state === 'failed' && <XCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--error)' }} aria-hidden="true" />}
        <span className="min-w-0 break-words">
          <span className="text-text-main">{item.label}</span>
          {item.state === 'failed' && <span className="sr-only"> (failed)</span>}
          {(item.summary ?? item.args_summary) && <span>: {item.summary ?? item.args_summary}</span>}
        </span>
      </div>
      {item.details && (
        <details className="ml-6" data-testid="tool-details">
          <summary className="cursor-pointer text-xs text-primary">Details</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded border border-border-warm bg-background-light p-2 text-xs text-text-main">
            {shown.join('\n')}
            {lines.length > shown.length ? `\n... ${lines.length - shown.length} more lines not shown` : ''}
          </pre>
        </details>
      )}
    </div>
  );
}

const PUBLISH_VARIANT: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  published: 'success', failed: 'error', blocked_gates: 'error', conflict: 'warning', running: 'info', queued: 'info',
};

export function EventItem({ sessionId, item }: { sessionId: string; item: TimelineItem }) {
  switch (item.type) {
    case 'message':
      return (
        <div className={item.from === 'designer' ? 'flex justify-end' : 'flex justify-start'}>
          <p
            className={`max-w-[90%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${item.from === 'designer' ? 'bg-primary/10 text-text-main' : 'border border-border-warm bg-surface text-text-main'}`}
            data-from={item.from}
          >
            {item.text}
          </p>
        </div>
      );
    case 'thought':
      return (
        <details className="text-xs text-text-sub">
          <summary className="cursor-pointer">Thinking</summary>
          <p className="mt-1 whitespace-pre-wrap">{item.text}</p>
        </details>
      );
    case 'tool':
      return <ToolLine item={item} />;
    case 'screenshot':
      return (
        <div className="flex flex-wrap gap-2" data-testid="screenshots">
          {item.asset_ids.map((id, i) => (
            <a key={id} href={assetUrl(sessionId, id)} target="_blank" rel="noopener noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element -- private, session-scoped asset route */}
              <img
                src={assetUrl(sessionId, id)}
                alt={`${item.purpose === 'before' ? 'Before' : item.purpose === 'crop' ? 'Crop' : 'After'} screenshot${item.widths[i] ? ` at ${item.widths[i]} pixels wide` : ''}`}
                loading="lazy"
                className="h-24 w-auto max-w-full rounded border border-border-warm object-cover"
              />
            </a>
          ))}
        </div>
      );
    case 'gate':
      return <GateCard sessionId={sessionId} item={item} />;
    case 'status':
      return <p className="text-center text-xs text-text-sub" data-testid="status-line">{item.text}</p>;
    case 'followup':
      return (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-text-sub">Filed a follow-up:</span>
          <Badge variant="info" size="sm" data-testid="followup-chip">{item.title}</Badge>
        </div>
      );
    case 'publish':
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="publish-event">
          <Badge variant={PUBLISH_VARIANT[item.status] ?? 'default'} size="sm">{item.kind === 'rollback' ? 'Rollback' : 'Publish'}: {item.status.replace(/_/g, ' ')}</Badge>
          {item.summary && <span className="text-text-sub">{item.summary}</span>}
          {item.publish_id && item.status === 'published' && (
            <a href={`/design/publishes/${item.publish_id}`} className="text-primary underline">View</a>
          )}
        </div>
      );
    case 'client_files':
      return <p className="text-xs text-text-sub" data-testid="client-files-line">Client folder listed: {item.count} {item.count === 1 ? 'item' : 'items'}.</p>;
    case 'apply':
      return (
        <p className="text-xs text-text-sub" data-testid="apply-line">
          Sent {item.pins} {item.pins === 1 ? 'pin' : 'pins'} to the worker{item.note ? `: ${item.note}` : '.'}
        </p>
      );
    case 'change':
      return <p className="text-xs text-text-sub">A change was recorded. See the Changes tab.</p>;
  }
}
