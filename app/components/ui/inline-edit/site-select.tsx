'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X, Search } from 'lucide-react';
import { useSites } from '@/lib/hooks/use-sites';
import type { SiteWithRelations } from '@/types/entities';

interface SiteSelectProps {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
  excludeIds?: string[]; // Exclude sites from the list (e.g., sites already assigned to a client)
  allowClear?: boolean; // Whether to show the "Clear selection" option (default: true)
}

export function SiteSelect({
  value,
  onChange,
  placeholder = 'Select site...',
  className = '',
  excludeIds = [],
  allowClear = true,
}: SiteSelectProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [dropdownPosition, setDropdownPosition] = React.useState({ top: 0, left: 0 });
  const ref = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const { data, isLoading } = useSites({ limit: 100 });

  const sites = React.useMemo(() => {
    let list = data?.sites || [];
    if (excludeIds.length > 0) {
      const excludeSet = new Set(excludeIds);
      list = list.filter((s: SiteWithRelations) => !excludeSet.has(s.id));
    }
    return list;
  }, [data?.sites, excludeIds]);

  // Update dropdown position when opened or on scroll
  React.useEffect(() => {
    const updatePosition = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setDropdownPosition({
          top: rect.bottom + 4,
          left: rect.left,
        });
      }
    };

    if (isOpen) {
      updatePosition();
      // Update position on scroll to keep dropdown attached
      window.addEventListener('scroll', updatePosition, true);
      return () => window.removeEventListener('scroll', updatePosition, true);
    }
  }, [isOpen]);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
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

  const selectedSite = sites.find((s: SiteWithRelations) => s.id === value);
  const displayLabel = selectedSite?.name || placeholder;

  const filteredSites = sites.filter((s: SiteWithRelations) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  // Get primary domain for subtitle
  const getPrimaryDomain = (site: SiteWithRelations) => {
    if (site.primary_domain) {
      return site.primary_domain.name;
    }
    return null;
  };

  const dropdown = isOpen && (
    <div
      ref={dropdownRef}
      className="fixed z-[9999] w-72 bg-surface border border-border rounded-lg shadow-lg"
      style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
    >
      {/* Search input */}
      <div className="p-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-text-sub" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sites..."
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface-alt border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Options */}
      <div className="max-h-48 overflow-auto py-1">
        {/* Clear option */}
        {allowClear && value && (
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
        ) : filteredSites.length === 0 ? (
          <div className="px-3 py-2 text-sm text-text-sub">No sites found</div>
        ) : (
          filteredSites.map((site: SiteWithRelations) => {
            const domain = getPrimaryDomain(site);
            return (
              <button
                key={site.id}
                type="button"
                onClick={() => {
                  onChange(site.id);
                  setIsOpen(false);
                  setSearch('');
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-alt ${
                  site.id === value ? 'bg-primary/10 text-primary' : 'text-text-main'
                }`}
              >
                <div>{site.name}</div>
                {domain && (
                  <div className="text-xs text-text-sub">{domain}</div>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 cursor-pointer hover:bg-surface-alt px-2 py-1 -mx-2 -my-1 rounded transition-colors"
      >
        <span className={value ? 'text-text-main' : 'text-text-sub italic'}>
          {displayLabel}
        </span>
        <ChevronDown className="h-3 w-3 text-text-sub" />
      </button>

      {typeof document !== 'undefined' && createPortal(dropdown, document.body)}
    </div>
  );
}
