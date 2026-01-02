'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { Task } from '@/lib/hooks/use-tasks';

interface SortableProjectTaskProps {
  task: Task;
  children: React.ReactNode;
  disabled?: boolean;
}

export function SortableProjectTask({
  task,
  children,
  disabled = false,
}: SortableProjectTaskProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
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
        'flex items-center group',
        isDragging && 'opacity-50 z-50'
      )}
    >
      {!disabled && (
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 mr-1 hover:bg-surface-raised rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          tabIndex={-1}
        >
          <GripVertical className="h-4 w-4 text-text-sub" />
        </button>
      )}
      <div className={cn('flex-1', !disabled && '-ml-6 pl-6')}>
        {children}
      </div>
    </div>
  );
}
