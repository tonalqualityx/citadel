'use client';

import * as React from 'react';
import { useFunctions } from '@/lib/hooks/use-reference-data';
import { Combobox, InlineCombobox, type ComboboxOption } from './combobox';
import { Spinner } from './spinner';

interface FunctionSelectProps {
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Form-style function selector with type-to-filter
 */
export function FunctionSelect({
  value,
  onChange,
  label,
  placeholder = 'No function',
  disabled = false,
  className,
}: FunctionSelectProps) {
  const { data, isLoading } = useFunctions();

  const options: ComboboxOption[] = React.useMemo(() => {
    if (!data?.functions) return [];
    return data.functions.map((f) => ({
      value: f.id,
      label: f.name,
    }));
  }, [data]);

  if (isLoading) {
    return (
      <div className={className}>
        {label && (
          <label className="block text-sm font-medium text-text-main mb-1.5">
            {label}
          </label>
        )}
        <div className="h-10 flex items-center justify-center border border-border rounded-lg bg-surface">
          <Spinner size="sm" />
        </div>
      </div>
    );
  }

  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      label={label}
      placeholder={placeholder}
      searchPlaceholder="Search functions..."
      emptyMessage="No functions found"
      disabled={disabled}
      className={className}
    />
  );
}

interface InlineFunctionSelectProps {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  /** Override display text (e.g., from existing function object) */
  displayValue?: string;
}

/**
 * Inline function selector for detail/view pages
 * Displays as clickable text that opens a searchable dropdown
 */
export function InlineFunctionSelect({
  value,
  onChange,
  placeholder = 'No function',
  displayValue,
}: InlineFunctionSelectProps) {
  const { data, isLoading } = useFunctions();

  const options: ComboboxOption[] = React.useMemo(() => {
    if (!data?.functions) return [];
    return data.functions.map((f) => ({
      value: f.id,
      label: f.name,
    }));
  }, [data]);

  // If we have a displayValue, use it; otherwise find from options
  const display = displayValue || options.find((o) => o.value === value)?.label;

  if (isLoading) {
    return <Spinner size="sm" />;
  }

  return (
    <InlineCombobox
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder="Search functions..."
      emptyMessage="No functions found"
      displayValue={display}
    />
  );
}
