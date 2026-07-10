'use client';

import * as React from 'react';
import { ChevronsDownUp, ChevronsUpDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import type { OracleMachineDTO } from '@/lib/types/oracle';
import { NewSessionModal } from './NewSessionModal';

interface OracleToolbarProps {
  filter: string;
  onFilterChange: (value: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Unfiltered fleet machines — feeds the New Session modal's machine select and
   *  cwd datalist, independent of whatever the toolbar's own text filter matches. */
  machines: OracleMachineDTO[];
}

// Ringside toolbar: filter input + collapse-all + (1.5b) New Session. Filter matches
// session AND agent fields (see sessionMatchesFilter); collapse-all hides every
// card's agent/task grid at once, same as Ringside's global `.run.collapsed` toggle.
// New Session is safe to always render here — the page-level admin gate already
// guarantees only admins ever mount OracleToolbar at all.
export function OracleToolbar({
  filter,
  onFilterChange,
  collapsed,
  onToggleCollapsed,
  machines,
}: OracleToolbarProps) {
  const [newSessionOpen, setNewSessionOpen] = React.useState(false);

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
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={() => setNewSessionOpen(true)}
        className="ui-monospace min-h-11 shrink-0 sm:min-h-0"
      >
        <Plus className="h-4 w-4" />
        New session
      </Button>

      <NewSessionModal open={newSessionOpen} onOpenChange={setNewSessionOpen} machines={machines} />
    </div>
  );
}
