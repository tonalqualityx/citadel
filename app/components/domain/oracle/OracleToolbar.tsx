'use client';

import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';

interface OracleToolbarProps {
  filter: string;
  onFilterChange: (value: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

// Ringside toolbar: filter input + collapse-all. Filter matches session AND agent
// fields (see sessionMatchesFilter); collapse-all hides every card's agent/task grid
// at once, same as Ringside's global `.run.collapsed` toggle.
export function OracleToolbar({
  filter,
  onFilterChange,
  collapsed,
  onToggleCollapsed,
}: OracleToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-warm px-1 py-2">
      <SearchInput
        value={filter}
        onChange={onFilterChange}
        placeholder="filter sessions & agents…"
        className="max-w-xs flex-1"
        aria-label="Filter sessions and agents"
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onToggleCollapsed}
        className="ui-monospace min-h-11 shrink-0 sm:min-h-0"
      >
        {collapsed ? (
          <ChevronsUpDown className="h-4 w-4" />
        ) : (
          <ChevronsDownUp className="h-4 w-4" />
        )}
        {collapsed ? 'Expand all' : 'Collapse all'}
      </Button>
    </div>
  );
}
