'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface ProjectPhase {
  id: string;
  name: string;
  icon: string | null;
  sort_order: number;
}

interface SortableProjectPhaseProps {
  phase: ProjectPhase;
  children: React.ReactNode;
  disabled?: boolean;
  renderGripHandle?: boolean;
}

export function SortableProjectPhase({
  phase,
  children,
  disabled = false,
  renderGripHandle = true,
}: SortableProjectPhaseProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: phase.id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative',
        isDragging && 'opacity-50 z-50 shadow-lg'
      )}
    >
      {/* Inject the grip handle as a data attribute so the header can use it */}
      <div
        data-phase-grip
        {...(renderGripHandle && !disabled
          ? { ...attributes, ...listeners }
          : {})}
        className={cn(
          'absolute left-0 top-0 h-full w-8 flex items-center justify-center',
          !disabled && 'cursor-grab active:cursor-grabbing',
          disabled && 'hidden'
        )}
      >
        <GripVertical className="h-4 w-4 text-text-sub" />
      </div>
      <div className={cn(!disabled && 'ml-8')}>
        {children}
      </div>
    </div>
  );
}

// Export grip handle component for use in custom headers
export function PhaseGripHandle({
  attributes,
  listeners,
  disabled = false,
}: {
  attributes?: Record<string, unknown>;
  listeners?: Record<string, unknown>;
  disabled?: boolean;
}) {
  if (disabled) return null;

  return (
    <button
      {...attributes}
      {...listeners}
      className="cursor-grab active:cursor-grabbing p-1 hover:bg-surface rounded flex-shrink-0"
      tabIndex={-1}
    >
      <GripVertical className="h-4 w-4 text-text-sub" />
    </button>
  );
}
