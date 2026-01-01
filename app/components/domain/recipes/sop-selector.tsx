'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { useSops, type Sop } from '@/lib/hooks/use-sops';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import {
  getEnergyLabel,
  getMysteryFactorLabel,
  getBatteryImpactLabel,
  getBatteryImpactVariant,
} from '@/lib/calculations/energy';
import { MysteryFactor, BatteryImpact } from '@prisma/client';
import { cn } from '@/lib/utils/cn';

interface SopSelectorProps {
  value: string | null;
  onChange: (sopId: string | null, sop: Sop | null) => void;
  className?: string;
  showLabel?: boolean;
  showPreview?: boolean;
}

export function SopSelector({
  value,
  onChange,
  className,
  showLabel = true,
  showPreview = true,
}: SopSelectorProps) {
  const [search, setSearch] = React.useState('');
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const { data, isLoading } = useSops({
    search: search || undefined,
    limit: 50,
  });

  const sops = data?.sops || [];
  const selectedSop = sops.find((s) => s.id === value) || null;

  // Close dropdown when clicking outside
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (sop: Sop) => {
    onChange(sop.id, sop);
    setIsOpen(false);
    setSearch('');
  };

  const handleClear = () => {
    onChange(null, null);
    setSearch('');
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {showLabel && (
        <label className="block text-sm font-medium text-text-main mb-1">
          SOP Template *
        </label>
      )}

      {/* Selected SOP Display or Search Input */}
      {selectedSop && !isOpen ? (
        <div
          className="flex items-center justify-between p-3 border border-border rounded-lg bg-surface cursor-pointer hover:border-primary"
          onClick={() => setIsOpen(true)}
        >
          <div>
            <div className="font-medium text-text-main">{selectedSop.title}</div>
            {selectedSop.function && (
              <div className="text-sm text-text-sub">{selectedSop.function.name}</div>
            )}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleClear();
            }}
            className="text-text-sub hover:text-text-main"
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-text-sub" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            placeholder="Search SOPs..."
            className="pl-10"
          />
        </div>
      )}

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 max-h-64 overflow-auto bg-surface border border-border rounded-lg shadow-lg">
          {isLoading ? (
            <div className="flex items-center justify-center p-4">
              <Spinner size="sm" />
            </div>
          ) : sops.length === 0 ? (
            <div className="p-4 text-center text-text-sub">
              {search ? 'No SOPs found' : 'No SOPs available'}
            </div>
          ) : (
            sops.map((sop) => (
              <div
                key={sop.id}
                onClick={() => handleSelect(sop)}
                className={cn(
                  'p-3 cursor-pointer hover:bg-surface-alt border-b border-border last:border-b-0',
                  sop.id === value && 'bg-primary/10'
                )}
              >
                <div className="font-medium text-text-main">{sop.title}</div>
                <div className="flex items-center gap-2 mt-1 text-sm text-text-sub">
                  {sop.function && <span>{sop.function.name}</span>}
                  {sop.energy_estimate && (
                    <span>• {getEnergyLabel(sop.energy_estimate)}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* SOP Preview */}
      {showPreview && selectedSop && <SopPreview sop={selectedSop} />}
    </div>
  );
}

interface SopPreviewProps {
  sop: Sop;
}

export function SopPreview({ sop }: SopPreviewProps) {
  const priorityLabels: Record<number, string> = {
    1: 'Highest',
    2: 'High',
    3: 'Medium',
    4: 'Low',
    5: 'Lowest',
  };

  return (
    <div className="mt-3 p-3 border border-border rounded-lg bg-surface-alt">
      <div className="text-xs font-medium text-text-sub uppercase mb-2">
        SOP Defaults (Applied to Task)
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-text-sub">Function</span>
          <span className="text-text-main font-medium">
            {sop.function?.name || 'None'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-sub">Priority</span>
          <span className="text-text-main font-medium">
            {priorityLabels[sop.default_priority] || 'Medium'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-sub">Energy</span>
          <span className="text-text-main font-medium">
            {sop.energy_estimate ? getEnergyLabel(sop.energy_estimate) : 'Not set'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-sub">Mystery</span>
          <span className="text-text-main font-medium">
            {getMysteryFactorLabel(sop.mystery_factor as MysteryFactor)}
          </span>
        </div>
        <div className="flex items-center justify-between col-span-2">
          <span className="text-text-sub">Battery Impact</span>
          <Badge variant={getBatteryImpactVariant(sop.battery_impact as BatteryImpact)}>
            {getBatteryImpactLabel(sop.battery_impact as BatteryImpact)}
          </Badge>
        </div>
      </div>
    </div>
  );
}
