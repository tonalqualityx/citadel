'use client';

import * as React from 'react';
import Link from 'next/link';
import { GitBranch } from 'lucide-react';
import { Tooltip } from '@/components/ui/tooltip';
import { usePipelineAccords, type PipelineAccordRow } from '@/lib/hooks/use-accords';
import { CollapsibleGroup } from './CollapsibleGroup';

// Clarity Phase 3 (Seeing Stone Reckoning, spec Q1) — the pipeline lane: accords grouped
// into exactly THREE forward-motion-framed groupings (Accord keeps its full 7-stage
// status underneath — the glass never shows stage as the tracked thing). Each row is the
// accord + the OPEN arc actually moving it forward (a link), or a quiet "no active arc"
// marker — THAT marker is the signal Mike needs, something in the pipeline with nothing
// moving it. Read + link only — no stage-editing UI, no drag, this round.
function PipelineRow({ row }: { row: PipelineAccordRow }) {
  const label = row.lead_business_name ?? row.lead_name ?? row.client?.name ?? row.name;

  return (
    <div
      className="flex items-center justify-between gap-2 rounded border border-border-warm/60 px-2 py-1.5 text-sm"
      data-testid="pipeline-row"
    >
      <span className="truncate text-text-main">{label}</span>
      {row.open_arc ? (
        <Link
          href={`/oracle/arcs/${row.open_arc.id}`}
          className="shrink-0 truncate text-xs text-text-sub underline-offset-2 hover:text-text-main hover:underline"
          data-testid="pipeline-row-arc-link"
        >
          {row.open_arc.name}
        </Link>
      ) : (
        <Tooltip content="Nothing is currently moving this forward — worth a next-touch date or a new arc">
          <span
            className="shrink-0 text-xs italic text-text-sub"
            data-testid="pipeline-row-no-arc"
          >
            no active arc
          </span>
        </Tooltip>
      )}
    </div>
  );
}

export function PipelineLane() {
  const { data } = usePipelineAccords();
  if (!data) return null;

  const { prospect, in_motion: inMotion, closed } = data.groups;
  if (prospect.length === 0 && inMotion.length === 0 && closed.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" data-testid="pipeline-lane">
      <h2 className="flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wide text-text-sub">
        <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
        Pipeline
      </h2>
      <CollapsibleGroup title="Prospect" count={prospect.length} defaultOpen>
        <div className="flex flex-col gap-1">
          {prospect.map((row) => (
            <PipelineRow key={row.id} row={row} />
          ))}
        </div>
      </CollapsibleGroup>
      <CollapsibleGroup title="In motion" count={inMotion.length} defaultOpen>
        <div className="flex flex-col gap-1">
          {inMotion.map((row) => (
            <PipelineRow key={row.id} row={row} />
          ))}
        </div>
      </CollapsibleGroup>
      <CollapsibleGroup title="Closed" count={closed.length}>
        <div className="flex flex-col gap-1">
          {closed.map((row) => (
            <PipelineRow key={row.id} row={row} />
          ))}
        </div>
      </CollapsibleGroup>
    </section>
  );
}
