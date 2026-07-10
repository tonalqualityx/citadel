'use client';

import { cn } from '@/lib/utils/cn';
import { getStatusMeta } from './oracle-logic';

interface StatusDotProps {
  status: string | null | undefined;
  needsAttention?: boolean;
  className?: string;
}

// Ringside's dot, Citadel's palette: color always comes from a theme CSS variable
// (never a hardcoded hex) so the same status reads correctly in light/dim/dark.
// running gets a subtle pulse; needs_attention gets a ring in addition to its color.
export function StatusDot({ status, needsAttention = false, className }: StatusDotProps) {
  const meta = getStatusMeta(status, needsAttention);
  const color = `var(${meta.colorVar})`;

  return (
    <span
      role="img"
      aria-label={meta.label}
      title={meta.label}
      className={cn(
        'inline-block h-2.5 w-2.5 shrink-0 rounded-full',
        meta.pulse && 'animate-pulse',
        className
      )}
      style={{
        backgroundColor: color,
        boxShadow: meta.ring
          ? `0 0 0 3px color-mix(in srgb, ${color} 35%, transparent)`
          : `0 0 6px color-mix(in srgb, ${color} 55%, transparent)`,
      }}
    />
  );
}
