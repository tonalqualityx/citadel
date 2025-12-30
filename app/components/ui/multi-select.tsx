'use client';

import * as React from 'react';
import { ChevronDown, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  label,
  className,
}: MultiSelectProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Close on click outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleOption = (optionValue: string) => {
    if (value.includes(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  };

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const selectedLabels = options
    .filter((opt) => value.includes(opt.value))
    .map((opt) => opt.label);

  const displayText =
    selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length <= 2
      ? selectedLabels.join(', ')
      : `${selectedLabels.length} selected`;

  return (
    <div className={cn('w-full', className)} ref={containerRef}>
      {label && (
        <label className="block text-sm font-medium text-text-main mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            'w-full h-10 pl-3 pr-10 rounded-lg border border-border-warm bg-surface',
            'text-sm text-left cursor-pointer flex items-center',
            'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
            'transition-colors',
            value.length === 0 ? 'text-text-sub' : 'text-text-main'
          )}
        >
          <span className="flex-1 truncate">{displayText}</span>
          {value.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={clearAll}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') clearAll(e as unknown as React.MouseEvent); }}
              className="absolute right-8 p-0.5 hover:bg-surface-raised rounded cursor-pointer"
            >
              <X className="h-3 w-3 text-text-sub" />
            </span>
          )}
          <ChevronDown
            className={cn(
              'absolute right-3 h-4 w-4 text-text-sub transition-transform',
              isOpen && 'rotate-180'
            )}
          />
        </button>

        {isOpen && (
          <div className="absolute z-50 mt-1 w-full rounded-lg border border-border-warm bg-surface shadow-lg">
            <div className="py-1 max-h-60 overflow-auto">
              {options.map((option) => {
                const isSelected = value.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleOption(option.value)}
                    className={cn(
                      'w-full px-3 py-2 text-sm text-left flex items-center gap-2',
                      'hover:bg-surface-raised transition-colors',
                      isSelected && 'bg-primary/5'
                    )}
                  >
                    <div
                      className={cn(
                        'w-4 h-4 rounded border flex items-center justify-center',
                        isSelected
                          ? 'bg-primary border-primary'
                          : 'border-border-warm'
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3 text-white" />}
                    </div>
                    <span className="text-text-main">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
