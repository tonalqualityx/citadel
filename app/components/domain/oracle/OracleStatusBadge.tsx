'use client';

import { cn } from '@/lib/utils/cn';
import { getStatusMeta } from './oracle-logic';

interface OracleStatusBadgeProps {
  status: string | null | undefined;
  needsAttention?: boolean;
  className?: string;
}

// StageBadge-style status→variant lookup, but reading straight off theme CSS
// variables (getStatusMeta) instead of the badge.tsx CVA enum — Oracle's status set
// (running/waiting/needs_attention/done/failed/stale/queued) doesn't map 1:1 onto
// Badge's variants, and needs_attention needs a ring badge.tsx doesn't have.
export function OracleStatusBadge({
  status,
  needsAttention = false,
  className,
}: OracleStatusBadgeProps) {
  const meta = getStatusMeta(status, needsAttention);
  const color = `var(${meta.colorVar})`;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide',
        'ui-monospace',
        className
      )}
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
        boxShadow: meta.ring ? `0 0 0 1.5px color-mix(in srgb, ${color} 55%, transparent)` : undefined,
      }}
    >
      {meta.label}
    </span>
  );
}
