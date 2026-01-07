'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';

// Client status options
const CLIENT_STATUS_OPTIONS = [
  { value: 'active', label: 'Active', variant: 'success' as const },
  { value: 'inactive', label: 'Inactive', variant: 'default' as const },
  { value: 'delinquent', label: 'Delinquent', variant: 'warning' as const },
];

// Client type options
const CLIENT_TYPE_OPTIONS = [
  { value: 'direct', label: 'Direct' },
  { value: 'agency_partner', label: 'Agency Partner' },
  { value: 'sub_client', label: 'Sub-Client' },
];

interface ClientStatusInlineSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function ClientStatusInlineSelect({
  value,
  onChange,
  disabled,
}: ClientStatusInlineSelectProps) {
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

  const currentOption = CLIENT_STATUS_OPTIONS.find((o) => o.value === value) || CLIENT_STATUS_OPTIONS[0];

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) setIsOpen(!isOpen);
        }}
        disabled={disabled}
        className="hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Badge variant={currentOption.variant}>{currentOption.label}</Badge>
      </button>
      {isOpen && (
        <div className="absolute z-50 mt-1 w-36 bg-surface border border-border rounded-lg shadow-lg py-1">
          {CLIENT_STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 hover:bg-surface-alt transition-colors ${
                option.value === value ? 'bg-surface-alt' : ''
              }`}
            >
              <Badge variant={option.variant}>{option.label}</Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ClientTypeInlineSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function ClientTypeInlineSelect({
  value,
  onChange,
  disabled,
}: ClientTypeInlineSelectProps) {
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

  const currentOption = CLIENT_TYPE_OPTIONS.find((o) => o.value === value) || CLIENT_TYPE_OPTIONS[0];

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) setIsOpen(!isOpen);
        }}
        disabled={disabled}
        className="text-sm text-text-sub hover:text-text-main transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {currentOption.label}
      </button>
      {isOpen && (
        <div className="absolute z-50 mt-1 w-40 bg-surface border border-border rounded-lg shadow-lg py-1">
          {CLIENT_TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface-alt transition-colors ${
                option.value === value ? 'bg-surface-alt font-medium text-text-main' : 'text-text-sub'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
