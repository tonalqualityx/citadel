'use client';

import { Tooltip } from '@/components/ui/tooltip';
import type { Door } from './doors-logic';
import type { OracleMode } from '@/components/domain/oracle/modes/mode-shell-logic';

interface DoorsRowProps {
  doors: Door[];
  onGoToMode: (mode: OracleMode) => void;
}

const DOOR_TOOLTIP: Record<Door['id'], string> = {
  reviews: 'Opens the review queue in Process mode',
  intake: 'Opens the intake list in Process mode',
  pipeline: 'Opens the pipeline lane in Plan mode',
  due_soon: 'Opens due-soon items in Plan mode',
};

export function DoorsRow({ doors, onGoToMode }: DoorsRowProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="doors-row">
      {doors.map((door) => (
        <Tooltip key={door.id} content={DOOR_TOOLTIP[door.id]}>
          <button
            type="button"
            onClick={() => onGoToMode(door.target)}
            className="flex flex-col items-start gap-0.5 rounded-lg border border-border-warm bg-surface px-3 py-2.5 text-left hover:border-[color:var(--accent)]"
            data-testid={`door-${door.id}`}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold text-text-main">
              <span className="text-text-sub" aria-hidden="true">{door.glyph}</span>
              {door.label}
            </span>
            {door.detail && <span className="pl-4 text-xs text-text-sub">{door.detail}</span>}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
