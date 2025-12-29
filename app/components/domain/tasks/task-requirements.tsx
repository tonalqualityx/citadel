'use client';

import * as React from 'react';
import { Plus, X, Check, ChevronDown } from 'lucide-react';
import { useUpdateTask, Requirement } from '@/lib/hooks/use-tasks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import { getIconOption } from '@/lib/config/icons';
import {
  type RequirementEntry,
  type RequirementItem,
  type RequirementSection,
  isSection,
  normalizeRequirements,
} from '@/components/ui/sectioned-requirements-editor';

interface TaskRequirementsProps {
  taskId: string;
  requirements: RequirementEntry[] | Requirement[] | null;
  compact?: boolean; // Hide add/remove UI, just show toggleable list
  fieldName?: 'requirements' | 'review_requirements'; // Which field to update
}

export function TaskRequirements({
  taskId,
  requirements: initialRequirements,
  compact = false,
  fieldName = 'requirements',
}: TaskRequirementsProps) {
  const [requirements, setRequirements] = React.useState<RequirementEntry[]>(() =>
    normalizeRequirements(initialRequirements || [])
  );
  const [newRequirement, setNewRequirement] = React.useState('');
  const [isAdding, setIsAdding] = React.useState(false);
  const [isPending, setIsPending] = React.useState(false);
  const [collapsedSections, setCollapsedSections] = React.useState<Set<string>>(new Set());
  const inputRef = React.useRef<HTMLInputElement>(null);

  const updateTask = useUpdateTask();

  // Sync from props when not pending
  const initialReqsJson = JSON.stringify(initialRequirements || []);
  React.useEffect(() => {
    if (!isPending) {
      const parsed = JSON.parse(initialReqsJson);
      setRequirements(normalizeRequirements(parsed));
    }
  }, [initialReqsJson, isPending]);

  // Helper to get all items (flat + from sections)
  const getAllItems = (entries: RequirementEntry[]): RequirementItem[] => {
    const items: RequirementItem[] = [];
    entries.forEach((entry) => {
      if (isSection(entry)) {
        items.push(...entry.items);
      } else {
        items.push(entry as RequirementItem);
      }
    });
    return items;
  };

  // Calculate progress
  const allItems = getAllItems(requirements);
  const completedCount = allItems.filter((r) => r.completed).length;
  const totalCount = allItems.length;

  // Toggle section collapse
  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  // Toggle item completion
  const handleToggle = async (itemId: string, sectionId?: string) => {
    const updated = requirements.map((entry) => {
      if (isSection(entry)) {
        if (sectionId === entry.id) {
          return {
            ...entry,
            items: entry.items.map((item) =>
              item.id === itemId
                ? {
                    ...item,
                    completed: !item.completed,
                    completed_at: !item.completed ? new Date().toISOString() : undefined,
                  }
                : item
            ),
          };
        }
        return entry;
      } else if (entry.id === itemId) {
        return {
          ...entry,
          completed: !entry.completed,
          completed_at: !entry.completed ? new Date().toISOString() : undefined,
        };
      }
      return entry;
    });

    setRequirements(updated);
    setIsPending(true);

    try {
      await updateTask.mutateAsync({
        id: taskId,
        data: { [fieldName]: updated },
      });
    } finally {
      setIsPending(false);
    }
  };

  const handleAdd = async () => {
    if (!newRequirement.trim()) return;

    const newReq: RequirementItem = {
      id: crypto.randomUUID(),
      type: 'item',
      text: newRequirement.trim(),
      completed: false,
      completed_at: undefined,
      completed_by: undefined,
      sort_order: requirements.length,
    };

    const updated = [...requirements, newReq];
    setRequirements(updated);
    setNewRequirement('');
    setIsPending(true);

    try {
      await updateTask.mutateAsync({
        id: taskId,
        data: { [fieldName]: updated },
      });
    } finally {
      setIsPending(false);
    }
  };

  const handleRemove = async (itemId: string, sectionId?: string) => {
    let updated: RequirementEntry[];

    if (sectionId) {
      updated = requirements.map((entry) => {
        if (isSection(entry) && entry.id === sectionId) {
          return {
            ...entry,
            items: entry.items.filter((item) => item.id !== itemId),
          };
        }
        return entry;
      });
    } else {
      updated = requirements.filter((entry) => entry.id !== itemId);
    }

    setRequirements(updated);
    setIsPending(true);

    try {
      await updateTask.mutateAsync({
        id: taskId,
        data: { [fieldName]: updated },
      });
    } finally {
      setIsPending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
    if (e.key === 'Escape') {
      setIsAdding(false);
      setNewRequirement('');
    }
  };

  // Separate items and sections
  const topLevelItems = requirements.filter((e): e is RequirementItem => !isSection(e));
  const sections = requirements.filter((e): e is RequirementSection => isSection(e));

  // Render a single requirement item
  const renderItem = (item: RequirementItem, sectionId?: string) => (
    <div
      key={item.id}
      className={cn(
        'flex items-center gap-3 p-2 rounded-lg border border-border group',
        item.completed && 'bg-surface-2'
      )}
    >
      <button
        onClick={() => handleToggle(item.id, sectionId)}
        className={cn(
          'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors',
          item.completed
            ? 'bg-primary border-primary text-white'
            : 'border-border hover:border-primary'
        )}
      >
        {item.completed && <Check className="h-3 w-3" />}
      </button>
      <span
        className={cn(
          'flex-1 text-sm',
          item.completed ? 'text-text-sub line-through' : 'text-text-main'
        )}
      >
        {item.text}
      </span>
      {!compact && (
        <button
          onClick={() => handleRemove(item.id, sectionId)}
          className="opacity-0 group-hover:opacity-100 p-1 text-text-sub hover:text-red-500 transition-opacity"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  // Render a section
  const renderSection = (section: RequirementSection) => {
    const isCollapsed = collapsedSections.has(section.id);
    const sectionCompleted = section.items.filter((i) => i.completed).length;
    const sectionTotal = section.items.length;
    const iconOption = getIconOption(section.icon);

    return (
      <div key={section.id} className="border border-border rounded-lg overflow-hidden">
        {/* Section Header */}
        <button
          type="button"
          onClick={() => toggleSection(section.id)}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 bg-surface-alt',
            'hover:bg-surface-alt/80 transition-colors text-left'
          )}
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 text-text-sub transition-transform duration-200 flex-shrink-0',
              !isCollapsed && 'rotate-180'
            )}
          />
          {iconOption && <span className="text-base flex-shrink-0">{iconOption.emoji}</span>}
          <span className="flex-1 font-medium text-sm text-text-main truncate">
            {section.title}
          </span>
          <span className="text-xs text-text-sub flex-shrink-0">
            {sectionCompleted}/{sectionTotal}
          </span>
        </button>

        {/* Section Content */}
        {!isCollapsed && (
          <div className="p-3 space-y-2">
            {section.items.length === 0 ? (
              <p className="text-sm text-text-sub italic">No items in this section</p>
            ) : (
              section.items
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((item) => renderItem(item, section.id))
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Progress */}
      {totalCount > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(completedCount / totalCount) * 100}%` }}
            />
          </div>
          <span className="text-sm text-text-sub whitespace-nowrap">
            {completedCount} of {totalCount}
          </span>
        </div>
      )}

      {/* Top-level Items */}
      {topLevelItems.length > 0 && (
        <div className="space-y-2">
          {topLevelItems
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((item) => renderItem(item))}
        </div>
      )}

      {/* Sections */}
      {sections.length > 0 && (
        <div className="space-y-3">
          {sections
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((section) => renderSection(section))}
        </div>
      )}

      {/* Empty State */}
      {totalCount === 0 && !isAdding && (
        <p className="text-sm text-text-sub italic">No requirements</p>
      )}

      {/* Add New - hidden in compact mode */}
      {!compact &&
        (isAdding ? (
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={newRequirement}
              onChange={(e) => setNewRequirement(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a requirement..."
              className="flex-1"
              autoFocus
            />
            <Button size="sm" onClick={handleAdd} disabled={!newRequirement.trim()}>
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setIsAdding(false);
                setNewRequirement('');
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setIsAdding(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="w-full justify-start text-text-sub"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add requirement
          </Button>
        ))}
    </div>
  );
}
