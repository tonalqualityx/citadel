import { Badge } from '@/components/ui/badge';
import type { RunStage } from '@/lib/types/troubador';

const STAGE_LABELS: Record<RunStage, string> = {
  planning: 'Planning',
  topic_selection: 'Topic Selection',
  researching: 'Researching',
  ready_for_interview: 'Ready for Interview',
  in_production: 'In Production',
  done: 'Done',
  cancelled: 'Cancelled',
};

const STAGE_VARIANTS: Record<
  RunStage,
  'default' | 'info' | 'warning' | 'success' | 'error' | 'purple'
> = {
  planning: 'default',
  topic_selection: 'info',
  researching: 'info',
  ready_for_interview: 'warning',
  in_production: 'purple',
  done: 'success',
  cancelled: 'error',
};

export function stageLabel(stage: RunStage): string {
  return STAGE_LABELS[stage] ?? stage;
}

export function StageBadge({ stage }: { stage: RunStage }) {
  return (
    <Badge variant={STAGE_VARIANTS[stage] ?? 'default'} size="sm">
      {stageLabel(stage)}
    </Badge>
  );
}
