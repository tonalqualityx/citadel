'use client';

import * as React from 'react';
import { Search, Plus, X, Loader2, Repeat } from 'lucide-react';
import { useSops, type Sop } from '@/lib/hooks/use-sops';
import { useCreateTask } from '@/lib/hooks/use-recipes';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { getEnergyLabel } from '@/lib/calculations/energy';

interface InlineTaskAdderProps {
  recipeId: string;
  phaseId: string;
  onClose: () => void;
}

export function InlineTaskAdder({ recipeId, phaseId, onClose }: InlineTaskAdderProps) {
  const [search, setSearch] = React.useState('');
  const [isVariable, setIsVariable] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const createTask = useCreateTask();

  const { data, isLoading } = useSops({
    search: search || undefined,
    limit: 20,
  });

  const sops = data?.sops || [];

  // Focus input on mount
  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on escape
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Close on click outside
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to prevent immediate close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const handleSelect = async (sop: Sop) => {
    await createTask.mutateAsync({
      recipeId,
      phaseId,
      data: {
        sop_id: sop.id,
        title: null, // Use SOP title
        is_variable: isVariable,
        variable_source: isVariable ? 'sitemap_page' : null,
      },
    });
    onClose();
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 p-2 bg-surface-2 rounded-lg border border-primary">
        <Search className="h-4 w-4 text-text-sub flex-shrink-0" />
        <Input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search SOPs to add..."
          className="h-8 text-sm border-0 bg-transparent focus:ring-0 p-0"
        />
        <button
          type="button"
          onClick={() => setIsVariable(!isVariable)}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors flex-shrink-0',
            isVariable
              ? 'bg-primary text-white'
              : 'bg-surface text-text-sub hover:bg-surface-alt'
          )}
          title={isVariable ? 'Will create one task per page' : 'Click to make variable (one per page)'}
        >
          <Repeat className="h-3 w-3" />
          <span className="hidden sm:inline">{isVariable ? 'Variable' : 'Single'}</span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 flex-shrink-0"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Results dropdown */}
      <div className="absolute z-50 w-full mt-1 max-h-64 overflow-auto bg-surface border border-border rounded-lg shadow-lg">
        {createTask.isPending ? (
          <div className="flex items-center justify-center gap-2 p-4 text-text-sub">
            <Loader2 className="h-4 w-4 animate-spin" />
            Adding task...
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center gap-2 p-4 text-text-sub">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : sops.length === 0 ? (
          <div className="p-4 text-center text-text-sub text-sm">
            {search ? 'No SOPs found' : 'Type to search SOPs'}
          </div>
        ) : (
          sops.map((sop) => (
            <button
              key={sop.id}
              type="button"
              onClick={() => handleSelect(sop)}
              className="w-full text-left p-3 hover:bg-surface-alt border-b border-border last:border-b-0 transition-colors"
            >
              <div className="font-medium text-text-main text-sm">{sop.title}</div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-text-sub">
                {sop.function && <span>{sop.function.name}</span>}
                {sop.energy_estimate && (
                  <>
                    <span>•</span>
                    <span>{getEnergyLabel(sop.energy_estimate)}</span>
                  </>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

interface AddTaskButtonProps {
  onClick: () => void;
  className?: string;
}

export function AddTaskButton({ onClick, className }: AddTaskButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 text-sm text-text-sub hover:text-primary hover:bg-primary/5 rounded transition-colors',
        className
      )}
    >
      <Plus className="h-3.5 w-3.5" />
      Add Task
    </button>
  );
}
