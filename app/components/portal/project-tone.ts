import type { ChipTone } from '@/lib/portal/status-labels';

/** The chip tone for a project's client-facing status word (see projectStatusLabel). */
export function projectTone(label: string): ChipTone {
  if (label === 'Complete') return 'done';
  if (label === 'Starting soon') return 'quiet';
  if (label === 'In review') return 'attention';
  return 'moving';
}
