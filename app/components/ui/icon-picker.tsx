'use client';

import * as React from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { ICON_OPTIONS, ICON_CATEGORIES, getIconOption, type IconOption } from '@/lib/config/icons';

interface IconPickerProps {
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Icon picker with searchable dropdown and category grouping
 */
export function IconPicker({
  value,
  onChange,
  placeholder = 'Select icon...',
  className,
}: IconPickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [activeCategory, setActiveCategory] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selectedIcon = value ? getIconOption(value) : null;

  // Filter icons based on search
  const filteredOptions = React.useMemo(() => {
    let options = ICON_OPTIONS;

    if (search.trim()) {
      const searchLower = search.toLowerCase();
      options = options.filter(
        (opt) =>
          opt.name.toLowerCase().includes(searchLower) ||
          opt.label.toLowerCase().includes(searchLower) ||
          opt.category.toLowerCase().includes(searchLower)
      );
    }

    if (activeCategory) {
      options = options.filter((opt) => opt.category === activeCategory);
    }

    return options;
  }, [search, activeCategory]);

  // Group by category for display
  const groupedOptions = React.useMemo(() => {
    const groups: Record<string, IconOption[]> = {};
    filteredOptions.forEach((opt) => {
      if (!groups[opt.category]) {
        groups[opt.category] = [];
      }
      groups[opt.category].push(opt);
    });
    return groups;
  }, [filteredOptions]);

  // Close on click outside
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
        setActiveCategory(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus input when opened
  React.useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSelect = (iconName: string) => {
    onChange(iconName);
    setIsOpen(false);
    setSearch('');
    setActiveCategory(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setSearch('');
      setActiveCategory(null);
    }
  };

  return (
    <div ref={containerRef} className={cn('relative inline-block', className)}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-surface',
          'text-sm hover:bg-surface-alt transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary'
        )}
      >
        {selectedIcon ? (
          <>
            <span className="text-lg leading-none">{selectedIcon.emoji}</span>
            <span className="text-text-main">{selectedIcon.label}</span>
          </>
        ) : (
          <span className="text-text-sub">{placeholder}</span>
        )}
        <ChevronDown
          className={cn(
            'h-4 w-4 text-text-sub transition-transform ml-1',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-80 bg-surface border border-border rounded-lg shadow-lg overflow-hidden">
          {/* Search Input */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-sub" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search icons..."
                className={cn(
                  'w-full h-8 pl-9 pr-3 rounded-md border border-border bg-surface-alt',
                  'text-sm text-text-main placeholder:text-text-sub',
                  'focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary'
                )}
              />
            </div>
          </div>

          {/* Category Filters */}
          <div className="p-2 border-b border-border flex flex-wrap gap-1 max-h-24 overflow-y-auto">
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className={cn(
                'px-2 py-0.5 text-xs rounded-full transition-colors',
                !activeCategory
                  ? 'bg-primary text-white'
                  : 'bg-surface-alt text-text-sub hover:bg-surface-alt/80'
              )}
            >
              All
            </button>
            {ICON_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  'px-2 py-0.5 text-xs rounded-full transition-colors',
                  activeCategory === cat
                    ? 'bg-primary text-white'
                    : 'bg-surface-alt text-text-sub hover:bg-surface-alt/80'
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Icons Grid */}
          <div className="max-h-64 overflow-y-auto p-2">
            {Object.keys(groupedOptions).length === 0 ? (
              <div className="px-3 py-4 text-sm text-text-sub italic text-center">
                No icons found
              </div>
            ) : (
              Object.entries(groupedOptions).map(([category, icons]) => (
                <div key={category} className="mb-3 last:mb-0">
                  <div className="text-xs font-medium text-text-sub uppercase tracking-wide px-1 mb-1.5">
                    {category}
                  </div>
                  <div className="grid grid-cols-8 gap-1">
                    {icons.map((icon) => (
                      <button
                        key={icon.name}
                        type="button"
                        onClick={() => handleSelect(icon.name)}
                        title={icon.label}
                        className={cn(
                          'p-2 rounded-md flex items-center justify-center transition-colors',
                          'hover:bg-surface-alt text-xl',
                          icon.name === value && 'bg-primary/10 ring-1 ring-primary'
                        )}
                      >
                        {icon.emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Inline icon picker for detail/view pages
 * Shows current icon as clickable, opens picker on click
 */
interface InlineIconPickerProps {
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function InlineIconPicker({
  value,
  onChange,
  placeholder = 'Select icon',
}: InlineIconPickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selectedIcon = value ? getIconOption(value) : null;

  const filteredOptions = React.useMemo(() => {
    if (!search.trim()) return ICON_OPTIONS.slice(0, 40); // Show first 40 by default
    const searchLower = search.toLowerCase();
    return ICON_OPTIONS.filter(
      (opt) =>
        opt.name.toLowerCase().includes(searchLower) ||
        opt.label.toLowerCase().includes(searchLower)
    ).slice(0, 40);
  }, [search]);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  React.useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSelect = (iconName: string) => {
    onChange(iconName);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 rounded-md hover:bg-surface-alt transition-colors text-xl leading-none"
        title={selectedIcon?.label || placeholder}
      >
        {selectedIcon ? (
          selectedIcon.emoji
        ) : (
          <span className="text-sm text-text-sub">{placeholder}</span>
        )}
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-64 bg-surface border border-border rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-sub" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className={cn(
                  'w-full h-8 pl-9 pr-3 rounded-md border border-border bg-surface-alt',
                  'text-sm text-text-main placeholder:text-text-sub',
                  'focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary'
                )}
              />
            </div>
          </div>

          <div className="max-h-48 overflow-y-auto p-2">
            <div className="grid grid-cols-6 gap-1">
              {filteredOptions.map((icon) => (
                <button
                  key={icon.name}
                  type="button"
                  onClick={() => handleSelect(icon.name)}
                  title={icon.label}
                  className={cn(
                    'p-2 rounded-md flex items-center justify-center transition-colors',
                    'hover:bg-surface-alt text-xl',
                    icon.name === value && 'bg-primary/10 ring-1 ring-primary'
                  )}
                >
                  {icon.emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
