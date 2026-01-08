'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, Check } from 'lucide-react';
import { useSops, type Sop } from '@/lib/hooks/use-sops';
import { Badge } from '@/components/ui/badge';

interface SopMultiSelectProps {
  value: string[];
  onChange: (sopIds: string[]) => void;
  placeholder?: string;
  className?: string;
  variant?: 'inline' | 'input';
}

export function SopMultiSelect({
  value,
  onChange,
  placeholder = 'Select SOPs...',
  className = '',
  variant = 'inline',
}: SopMultiSelectProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [dropdownPosition, setDropdownPosition] = React.useState<{ top: number; left: number; width: number } | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const { data, isLoading } = useSops({ include_inactive: false, limit: 100 });
  const sops = data?.sops || [];

  const updatePosition = React.useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownHeight = 320; // max-h-80 = 320px
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

      // Position above if not enough space below
      const showAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

      setDropdownPosition({
        top: showAbove ? rect.top - dropdownHeight - 4 : rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 320), // At least 320px wide
      });
    }
  }, []);

  const handleOpen = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Calculate position from the clicked button immediately
    const rect = e.currentTarget.getBoundingClientRect();
    const dropdownHeight = 320;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const showAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

    setDropdownPosition({
      top: showAbove ? rect.top - dropdownHeight - 4 : rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 320),
    });
    setIsOpen(true);
  };

  // Update position on scroll/resize when open
  React.useEffect(() => {
    if (isOpen) {
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    } else {
      setDropdownPosition(null);
    }
  }, [isOpen, updatePosition]);

  // Close on click outside
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

  // Focus search on open
  React.useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const selectedSops = sops.filter((s: Sop) => value.includes(s.id));
  const displayLabel =
    selectedSops.length === 0
      ? placeholder
      : selectedSops.length === 1
        ? selectedSops[0].title
        : `${selectedSops.length} SOPs selected`;

  const filteredSops = sops.filter(
    (s: Sop) =>
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.function?.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggleSop = (sopId: string) => {
    if (value.includes(sopId)) {
      onChange(value.filter((id) => id !== sopId));
    } else {
      onChange([...value, sopId]);
    }
  };

  // For input variant (modals), render inline; for inline variant (tables), use portal
  const dropdownContent = (
    <div
      ref={dropdownRef}
      className={
        variant === 'input'
          ? 'absolute left-0 right-0 top-full mt-1 z-[9999] bg-surface border border-border rounded-lg shadow-lg'
          : 'fixed z-[9999] bg-surface border border-border rounded-lg shadow-lg'
      }
      style={
        variant === 'input'
          ? undefined
          : dropdownPosition
            ? {
                top: dropdownPosition.top,
                left: dropdownPosition.left,
                width: dropdownPosition.width,
              }
            : undefined
      }
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
            placeholder="Search SOPs..."
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface-alt border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Options */}
      <div className="max-h-64 overflow-auto py-1">
        {isLoading ? (
          <div className="px-3 py-2 text-sm text-text-sub">Loading...</div>
        ) : filteredSops.length === 0 ? (
          <div className="px-3 py-2 text-sm text-text-sub">
            {search ? 'No SOPs found' : 'No SOPs available'}
          </div>
        ) : (
          filteredSops.map((sop: Sop) => {
            const isSelected = value.includes(sop.id);
            return (
              <button
                key={sop.id}
                type="button"
                onClick={() => toggleSop(sop.id)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-alt flex items-center gap-3 ${
                  isSelected ? 'bg-primary/5' : ''
                }`}
              >
                <div
                  className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                    isSelected
                      ? 'bg-primary border-primary text-white'
                      : 'border-border-warm'
                  }`}
                >
                  {isSelected && <Check className="h-3 w-3" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-text-main truncate">{sop.title}</div>
                  {sop.function && (
                    <div className="text-xs text-text-sub">{sop.function.name}</div>
                  )}
                </div>
                {sop.energy_estimate && (
                  <Badge variant="default" className="text-xs flex-shrink-0">
                    {sop.energy_estimate}h
                  </Badge>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Footer with count */}
      <div className="px-3 py-2 border-t border-border text-xs text-text-sub">
        {value.length} SOP{value.length !== 1 ? 's' : ''} selected
      </div>
    </div>
  );

  const buttonClasses =
    variant === 'input'
      ? 'w-full flex items-center justify-between gap-2 cursor-pointer px-3 py-2 rounded-lg border border-border-warm bg-surface text-sm hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors'
      : 'flex items-center gap-2 cursor-pointer hover:bg-surface-alt px-2 py-1 -mx-2 -my-1 rounded transition-colors min-w-0';

  return (
    <div ref={ref} className={`relative ${variant === 'input' ? 'block' : 'inline-block'} ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => isOpen ? setIsOpen(false) : handleOpen(e)}
        className={buttonClasses}
      >
        <span
          className={`truncate ${value.length > 0 ? 'text-text-main' : 'text-text-sub'}`}
        >
          {displayLabel}
        </span>
        <ChevronDown className={`${variant === 'input' ? 'h-4 w-4' : 'h-3 w-3'} text-text-sub flex-shrink-0`} />
      </button>

      {isOpen && variant === 'input' && dropdownContent}
      {isOpen && variant === 'inline' && dropdownPosition && typeof document !== 'undefined' && createPortal(dropdownContent, document.body)}
    </div>
  );
}
