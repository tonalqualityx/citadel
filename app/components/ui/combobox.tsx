'use client';

import * as React from 'react';
import { ChevronDown, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  label?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyMessage = 'No results found',
  label,
  disabled = false,
  allowClear = true,
  className,
}: ComboboxProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  const filteredOptions = React.useMemo(() => {
    if (!search.trim()) return options;
    const searchLower = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(searchLower) ||
        o.description?.toLowerCase().includes(searchLower)
    );
  }, [options, search]);

  // Close on click outside
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

  // Focus input when opened
  React.useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue || null);
    setIsOpen(false);
    setSearch('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setSearch('');
    }
    if (e.key === 'Enter' && filteredOptions.length === 1) {
      handleSelect(filteredOptions[0].value);
    }
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {label && (
        <label className="block text-sm font-medium text-text-main mb-1.5">
          {label}
        </label>
      )}

      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          'w-full h-10 px-3 rounded-lg border border-border bg-surface',
          'text-sm text-text-main text-left flex items-center justify-between gap-2',
          'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'transition-colors',
          !selectedOption && 'text-text-sub'
        )}
      >
        <span className="truncate">
          {selectedOption?.label || placeholder}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {allowClear && selectedOption && (
            <span
              role="button"
              onClick={handleClear}
              className="p-0.5 hover:bg-surface-alt rounded transition-colors"
            >
              <X className="h-3.5 w-3.5 text-text-sub" />
            </span>
          )}
          <ChevronDown
            className={cn(
              'h-4 w-4 text-text-sub transition-transform',
              isOpen && 'rotate-180'
            )}
          />
        </div>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-surface border border-border rounded-lg shadow-lg overflow-hidden">
          {/* Search Input */}
          <div className="p-2 border-b border-border">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className={cn(
                'w-full h-8 px-3 rounded-md border border-border bg-surface-alt',
                'text-sm text-text-main placeholder:text-text-sub',
                'focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary'
              )}
            />
          </div>

          {/* Options List */}
          <div className="max-h-60 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-text-sub italic">
                {emptyMessage}
              </div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={cn(
                    'w-full px-3 py-2 text-left text-sm flex items-center gap-2',
                    'hover:bg-surface-alt transition-colors',
                    option.value === value && 'bg-primary/10'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-text-main truncate">{option.label}</div>
                    {option.description && (
                      <div className="text-xs text-text-sub truncate">
                        {option.description}
                      </div>
                    )}
                  </div>
                  {option.value === value && (
                    <Check className="h-4 w-4 text-primary flex-shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Inline version of Combobox for use in detail/view pages
 * Displays as a clickable pill that opens a dropdown with search
 */
interface InlineComboboxProps {
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  displayValue?: string;
}

export function InlineCombobox({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyMessage = 'No results found',
  displayValue,
}: InlineComboboxProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selectedOption = options.find((o) => o.value === value);
  const display = displayValue || selectedOption?.label || placeholder;

  const filteredOptions = React.useMemo(() => {
    if (!search.trim()) return options;
    const searchLower = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(searchLower) ||
        o.description?.toLowerCase().includes(searchLower)
    );
  }, [options, search]);

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

  const handleSelect = (optionValue: string) => {
    onChange(optionValue || null);
    setIsOpen(false);
    setSearch('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setSearch('');
    }
    if (e.key === 'Enter' && filteredOptions.length === 1) {
      handleSelect(filteredOptions[0].value);
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 hover:opacity-80 transition-opacity text-left"
      >
        <span className="text-sm text-text-main hover:text-primary transition-colors">
          {display}
        </span>
        <ChevronDown
          className={cn(
            'h-3 w-3 text-text-sub transition-transform',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-64 bg-surface border border-border rounded-lg shadow-lg overflow-hidden">
          {/* Search Input */}
          <div className="p-2 border-b border-border">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className={cn(
                'w-full h-8 px-3 rounded-md border border-border bg-surface-alt',
                'text-sm text-text-main placeholder:text-text-sub',
                'focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary'
              )}
            />
          </div>

          {/* Options List */}
          <div className="max-h-60 overflow-y-auto py-1">
            {/* Clear option */}
            <button
              type="button"
              onClick={() => handleSelect('')}
              className={cn(
                'w-full px-3 py-2 text-left text-sm flex items-center gap-2',
                'hover:bg-surface-alt transition-colors text-text-sub italic',
                !value && 'bg-primary/10'
              )}
            >
              <span className="flex-1">{placeholder}</span>
              {!value && <Check className="h-4 w-4 text-primary flex-shrink-0" />}
            </button>

            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-text-sub italic">
                {emptyMessage}
              </div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={cn(
                    'w-full px-3 py-2 text-left text-sm flex items-center gap-2',
                    'hover:bg-surface-alt transition-colors',
                    option.value === value && 'bg-primary/10'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-text-main truncate">{option.label}</div>
                    {option.description && (
                      <div className="text-xs text-text-sub truncate">
                        {option.description}
                      </div>
                    )}
                  </div>
                  {option.value === value && (
                    <Check className="h-4 w-4 text-primary flex-shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Creatable Combobox - allows selecting from options OR typing a custom value
 */
interface CreatableComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  createLabel?: (inputValue: string) => string;
  label?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
}

export function CreatableCombobox({
  options,
  value,
  onChange,
  placeholder = 'Select or type...',
  searchPlaceholder = 'Search or type new...',
  createLabel = (v) => `Create "${v}"`,
  label,
  disabled = false,
  allowClear = true,
  className,
}: CreatableComboboxProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selectedOption = options.find((o) => o.value === value);
  const displayValue = selectedOption?.label || value || '';

  const filteredOptions = React.useMemo(() => {
    if (!search.trim()) return options;
    const searchLower = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(searchLower) ||
        o.description?.toLowerCase().includes(searchLower)
    );
  }, [options, search]);

  // Check if search matches any existing option exactly
  const exactMatch = options.some(
    (o) => o.label.toLowerCase() === search.toLowerCase() || o.value.toLowerCase() === search.toLowerCase()
  );

  // Show create option if search has value and doesn't match existing
  const showCreateOption = search.trim() && !exactMatch;

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

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    setSearch('');
  };

  const handleCreate = () => {
    onChange(search.trim());
    setIsOpen(false);
    setSearch('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setSearch('');
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showCreateOption) {
        handleCreate();
      } else if (filteredOptions.length === 1) {
        handleSelect(filteredOptions[0].value);
      }
    }
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {label && (
        <label className="block text-sm font-medium text-text-main mb-1.5">
          {label}
        </label>
      )}

      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          'w-full h-10 px-3 rounded-lg border border-border bg-surface',
          'text-sm text-text-main text-left flex items-center justify-between gap-2',
          'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'transition-colors',
          !displayValue && 'text-text-sub'
        )}
      >
        <span className="truncate">
          {displayValue || placeholder}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {allowClear && value && (
            <span
              role="button"
              onClick={handleClear}
              className="p-0.5 hover:bg-surface-alt rounded transition-colors"
            >
              <X className="h-3.5 w-3.5 text-text-sub" />
            </span>
          )}
          <ChevronDown
            className={cn(
              'h-4 w-4 text-text-sub transition-transform',
              isOpen && 'rotate-180'
            )}
          />
        </div>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-surface border border-border rounded-lg shadow-lg overflow-hidden">
          {/* Search Input */}
          <div className="p-2 border-b border-border">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className={cn(
                'w-full h-8 px-3 rounded-md border border-border bg-surface-alt',
                'text-sm text-text-main placeholder:text-text-sub',
                'focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary'
              )}
            />
          </div>

          {/* Options List */}
          <div className="max-h-60 overflow-y-auto py-1">
            {/* Create new option */}
            {showCreateOption && (
              <button
                type="button"
                onClick={handleCreate}
                className={cn(
                  'w-full px-3 py-2 text-left text-sm flex items-center gap-2',
                  'hover:bg-surface-alt transition-colors text-primary'
                )}
              >
                <span className="flex-1">{createLabel(search.trim())}</span>
              </button>
            )}

            {filteredOptions.length === 0 && !showCreateOption ? (
              <div className="px-3 py-2 text-sm text-text-sub italic">
                Type to create a new option
              </div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={cn(
                    'w-full px-3 py-2 text-left text-sm flex items-center gap-2',
                    'hover:bg-surface-alt transition-colors',
                    option.value === value && 'bg-primary/10'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-text-main truncate">{option.label}</div>
                    {option.description && (
                      <div className="text-xs text-text-sub truncate">
                        {option.description}
                      </div>
                    )}
                  </div>
                  {option.value === value && (
                    <Check className="h-4 w-4 text-primary flex-shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
