'use client';

import * as React from 'react';
import { ChevronDown, X, Search } from 'lucide-react';
import { useHostingPlans } from '@/lib/hooks/use-reference-data';
import type { HostingPlan } from '@/types/entities';

interface HostingPlanSelectProps {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
}

export function HostingPlanSelect({
  value,
  onChange,
  placeholder = 'Select hosting plan...',
  className = '',
}: HostingPlanSelectProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const ref = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const { data, isLoading } = useHostingPlans();
  const plans = data?.hosting_plans || [];

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  React.useEffect(() => {
    if (isOpen) {
      searchRef.current?.focus();
    }
  }, [isOpen]);

  const selectedPlan = plans.find((p: HostingPlan) => p.id === value);
  const displayLabel = selectedPlan?.name || placeholder;

  const filteredPlans = plans.filter((p: HostingPlan) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 cursor-pointer hover:bg-surface-alt px-2 py-1 -mx-2 -my-1 rounded transition-colors"
      >
        <span className={value ? 'text-text-main' : 'text-text-sub italic'}>
          {displayLabel}
        </span>
        <ChevronDown className="h-3 w-3 text-text-sub" />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-64 bg-surface border border-border rounded-lg shadow-lg">
          {/* Search input */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-text-sub" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search plans..."
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface-alt border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Options */}
          <div className="max-h-48 overflow-auto py-1">
            {/* Clear option */}
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setIsOpen(false);
                  setSearch('');
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-alt flex items-center gap-2 text-text-sub"
              >
                <X className="h-4 w-4" />
                Clear selection
              </button>
            )}

            {isLoading ? (
              <div className="px-3 py-2 text-sm text-text-sub">Loading...</div>
            ) : filteredPlans.length === 0 ? (
              <div className="px-3 py-2 text-sm text-text-sub">No plans found</div>
            ) : (
              filteredPlans.map((plan: HostingPlan) => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => {
                    onChange(plan.id);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-alt ${
                    plan.id === value ? 'bg-primary/10 text-primary' : 'text-text-main'
                  }`}
                >
                  <div>{plan.name}</div>
                  <div className="text-xs text-text-sub">
                    ${Number(plan.rate).toFixed(2)}/mo
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
