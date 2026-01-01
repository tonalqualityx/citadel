'use client';

import * as React from 'react';
import { ChevronDown, X } from 'lucide-react';

interface Option {
  value: string;
  label: string;
}

interface InlineSelectProps {
  value: string | null;
  options: Option[];
  onChange: (value: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  className?: string;
  renderValue?: (value: string, label: string) => React.ReactNode;
}

export function InlineSelect({
  value,
  options,
  onChange,
  placeholder = 'Select...',
  allowClear = true,
  className = '',
  renderValue,
}: InlineSelectProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = selectedOption?.label || placeholder;

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 cursor-pointer hover:bg-surface-alt px-2 py-1 -mx-2 -my-1 rounded transition-colors"
      >
        {value && selectedOption && renderValue ? (
          renderValue(value, selectedOption.label)
        ) : (
          <span className={value ? 'text-text-main' : 'text-text-sub italic'}>
            {displayLabel}
          </span>
        )}
        <ChevronDown className="h-3 w-3 text-text-sub" />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 min-w-[180px] max-h-60 overflow-auto bg-surface border border-border rounded-lg shadow-lg py-1">
          {/* Clear option */}
          {allowClear && value && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setIsOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-surface-alt flex items-center gap-2 text-text-sub"
            >
              <X className="h-4 w-4" />
              Clear
            </button>
          )}

          {options.length === 0 ? (
            <div className="px-3 py-2 text-sm text-text-sub">No options</div>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-alt ${
                  option.value === value ? 'bg-primary/10 text-primary' : 'text-text-main'
                }`}
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
