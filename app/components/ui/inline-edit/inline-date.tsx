'use client';

import * as React from 'react';
import { Calendar } from 'lucide-react';

interface InlineDateProps {
  value: string | null; // ISO date string
  onChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
}

export function InlineDate({
  value,
  onChange,
  placeholder = 'Set date...',
  className = '',
}: InlineDateProps) {
  const inputId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const displayDate = value
    ? new Date(value).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dateStr = e.target.value;
    if (dateStr) {
      // Convert to ISO string (end of day in UTC to be safe)
      const isoValue = new Date(dateStr + 'T23:59:59.999Z').toISOString();
      onChange(isoValue);
    } else {
      onChange(null);
    }
  };

  const handleClick = () => {
    inputRef.current?.showPicker?.();
  };

  // Format value for input (YYYY-MM-DD)
  const inputValue = value ? value.split('T')[0] : '';

  return (
    <div
      className={`inline-flex items-center gap-2 cursor-pointer hover:bg-surface-alt px-2 py-1 -mx-2 -my-1 rounded transition-colors ${className}`}
      onClick={handleClick}
    >
      <Calendar className="h-4 w-4 text-text-sub flex-shrink-0" />
      <span className={displayDate ? 'text-text-main' : 'text-text-sub italic'}>
        {displayDate || placeholder}
      </span>
      <input
        ref={inputRef}
        id={inputId}
        type="date"
        value={inputValue}
        onChange={handleChange}
        className="absolute opacity-0 w-0 h-0 pointer-events-none"
      />
    </div>
  );
}
