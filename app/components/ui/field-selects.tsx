'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Select } from './select';
import {
  STATUS_OPTIONS,
  PRIORITY_OPTIONS,
  ENERGY_OPTIONS,
  MYSTERY_OPTIONS,
  BATTERY_OPTIONS,
  TASK_STATUS_OPTIONS,
  PROJECT_STATUS_OPTIONS,
  TASK_TYPE_OPTIONS,
  PRIORITY_SELECT_OPTIONS,
  ENERGY_SELECT_OPTIONS,
  MYSTERY_SELECT_OPTIONS,
  BATTERY_SELECT_OPTIONS,
  getStatusOption,
  getPriorityOption,
  getEnergyOption,
  getMysteryOption,
  getBatteryOption,
  getTaskStatusOption,
  getProjectStatusOption,
  getTaskTypeOption,
  type PriorityValue,
  type EnergyValue,
  type MysteryValue,
  type BatteryValue,
  type TaskStatusValue,
  type ProjectStatusValue,
  type TaskTypeValue,
} from '@/lib/config/task-fields';

// ============================================
// INLINE PILL SELECT (for view/detail pages)
// ============================================

interface InlinePillSelectProps<T> {
  value: T;
  options: readonly { value: T; label: string; color?: string; bg?: string }[];
  onChange: (value: T) => void;
  getOption: (value: T) => { label: string; color?: string; bg?: string };
  showChevron?: boolean; // Default: false (chevrons hidden)
}

function InlinePillSelect<T>({
  value,
  options,
  onChange,
  getOption,
  showChevron = false,
}: InlinePillSelectProps<T>) {
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

  const currentOption = getOption(value);
  const displayColor = currentOption.color || 'text-text-main';
  const displayBg = currentOption.bg || 'bg-surface-alt';

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 hover:opacity-80 transition-opacity text-left"
      >
        <span className={`text-sm font-medium px-2.5 py-0.5 rounded-full ${displayColor} ${displayBg}`}>
          {currentOption.label}
        </span>
        {showChevron && <ChevronDown className="h-3 w-3 text-text-sub" />}
      </button>
      {isOpen && (
        <div className="absolute z-50 mt-1 w-48 bg-surface border border-border rounded-lg shadow-lg py-2 px-2 space-y-1">
          {options.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-2.5 py-1 text-sm rounded-full transition-opacity hover:opacity-80 ${
                option.value === value ? 'ring-2 ring-primary ring-offset-1' : ''
              } ${option.color || ''} ${option.bg || 'bg-surface-alt'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// PRIORITY SELECT COMPONENTS
// ============================================

interface PriorityInlineSelectProps {
  value: number;
  onChange: (value: number) => void;
}

export function PriorityInlineSelect({ value, onChange }: PriorityInlineSelectProps) {
  return (
    <InlinePillSelect
      value={value}
      options={PRIORITY_OPTIONS}
      onChange={onChange}
      getOption={getPriorityOption}
    />
  );
}

interface PriorityFormSelectProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

export function PriorityFormSelect({ value, onChange, label }: PriorityFormSelectProps) {
  return (
    <Select
      label={label}
      options={PRIORITY_SELECT_OPTIONS}
      value={value}
      onChange={onChange}
      placeholder="Select priority"
    />
  );
}

// ============================================
// ENERGY SELECT COMPONENTS
// ============================================

interface EnergyInlineSelectProps {
  value: number | null;
  onChange: (value: number | null) => void;
}

export function EnergyInlineSelect({ value, onChange }: EnergyInlineSelectProps) {
  return (
    <InlinePillSelect
      value={value}
      options={ENERGY_OPTIONS}
      onChange={onChange}
      getOption={getEnergyOption}
    />
  );
}

interface EnergyFormSelectProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

export function EnergyFormSelect({ value, onChange, label }: EnergyFormSelectProps) {
  return (
    <Select
      label={label}
      options={ENERGY_SELECT_OPTIONS}
      value={value}
      onChange={onChange}
      placeholder="Select energy estimate"
    />
  );
}

// ============================================
// MYSTERY SELECT COMPONENTS
// ============================================

interface MysteryInlineSelectProps {
  value: string;
  onChange: (value: string) => void;
}

export function MysteryInlineSelect({ value, onChange }: MysteryInlineSelectProps) {
  return (
    <InlinePillSelect
      value={value}
      options={MYSTERY_OPTIONS}
      onChange={onChange}
      getOption={getMysteryOption}
    />
  );
}

interface MysteryFormSelectProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

export function MysteryFormSelect({ value, onChange, label }: MysteryFormSelectProps) {
  return (
    <Select
      label={label}
      options={MYSTERY_SELECT_OPTIONS}
      value={value}
      onChange={onChange}
      placeholder="Select mystery factor"
    />
  );
}

// ============================================
// BATTERY SELECT COMPONENTS
// ============================================

interface BatteryInlineSelectProps {
  value: string;
  onChange: (value: string) => void;
}

export function BatteryInlineSelect({ value, onChange }: BatteryInlineSelectProps) {
  return (
    <InlinePillSelect
      value={value}
      options={BATTERY_OPTIONS}
      onChange={onChange}
      getOption={getBatteryOption}
    />
  );
}

interface BatteryFormSelectProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

export function BatteryFormSelect({ value, onChange, label }: BatteryFormSelectProps) {
  return (
    <Select
      label={label}
      options={BATTERY_SELECT_OPTIONS}
      value={value}
      onChange={onChange}
      placeholder="Select battery impact"
    />
  );
}

// ============================================
// STATUS SELECT COMPONENTS (Active/Draft)
// ============================================

interface StatusInlineSelectProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

export function StatusInlineSelect({ value, onChange }: StatusInlineSelectProps) {
  return (
    <InlinePillSelect
      value={value}
      options={STATUS_OPTIONS}
      onChange={onChange}
      getOption={getStatusOption}
    />
  );
}

// ============================================
// TASK TYPE SELECT COMPONENTS (Ad-hoc vs Support)
// ============================================

interface TaskTypeInlineSelectProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

export function TaskTypeInlineSelect({ value, onChange }: TaskTypeInlineSelectProps) {
  return (
    <InlinePillSelect
      value={value}
      options={TASK_TYPE_OPTIONS}
      onChange={onChange}
      getOption={getTaskTypeOption}
    />
  );
}

// ============================================
// TASK STATUS SELECT COMPONENTS (workflow status)
// ============================================

interface TaskStatusInlineSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function TaskStatusInlineSelect({ value, onChange, disabled }: TaskStatusInlineSelectProps) {
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

  const currentOption = getTaskStatusOption(value);
  const displayColor = currentOption.color || 'text-text-main';
  const displayBg = currentOption.bg || 'bg-surface-alt';

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`flex items-center gap-1 transition-opacity text-left ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80'
        }`}
      >
        <span className={`text-sm font-medium px-2.5 py-0.5 rounded-full ${displayColor} ${displayBg}`}>
          {currentOption.label}
        </span>
      </button>
      {isOpen && !disabled && (
        <div className="absolute z-50 mt-1 w-48 bg-surface border border-border rounded-lg shadow-lg py-2 px-2 space-y-1">
          {TASK_STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-2.5 py-1 text-sm rounded-full transition-opacity hover:opacity-80 ${
                option.value === value ? 'ring-2 ring-primary ring-offset-1' : ''
              } ${option.color || ''} ${option.bg || 'bg-surface-alt'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// PROJECT STATUS SELECT COMPONENTS (workflow status)
// ============================================

interface ProjectStatusInlineSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  validStatuses?: string[]; // Only show these options (for transition restrictions)
}

export function ProjectStatusInlineSelect({ value, onChange, disabled, validStatuses }: ProjectStatusInlineSelectProps) {
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

  const currentOption = getProjectStatusOption(value);
  const displayColor = currentOption.color || 'text-text-main';
  const displayBg = currentOption.bg || 'bg-surface-alt';

  // Filter options to only valid transitions, or all if not specified
  const availableOptions = validStatuses
    ? PROJECT_STATUS_OPTIONS.filter((o) => o.value === value || validStatuses.includes(o.value))
    : PROJECT_STATUS_OPTIONS;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`flex items-center gap-1 transition-opacity text-left ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80'
        }`}
      >
        <span className={`text-sm font-medium px-2.5 py-0.5 rounded-full ${displayColor} ${displayBg}`}>
          {currentOption.label}
        </span>
        {!disabled && <ChevronDown className="h-3 w-3 text-text-sub" />}
      </button>
      {isOpen && !disabled && (
        <div className="absolute z-50 mt-1 w-48 bg-surface border border-border rounded-lg shadow-lg py-2 px-2 space-y-1">
          {availableOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                if (option.value !== value) {
                  onChange(option.value);
                }
                setIsOpen(false);
              }}
              className={`w-full text-left px-2.5 py-1 text-sm rounded-full transition-opacity hover:opacity-80 ${
                option.value === value ? 'ring-2 ring-primary ring-offset-1' : ''
              } ${option.color || ''} ${option.bg || 'bg-surface-alt'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// RE-EXPORT CONFIG FOR CONVENIENCE
// ============================================

export {
  STATUS_OPTIONS,
  PRIORITY_OPTIONS,
  ENERGY_OPTIONS,
  MYSTERY_OPTIONS,
  BATTERY_OPTIONS,
  TASK_STATUS_OPTIONS,
  PROJECT_STATUS_OPTIONS,
  TASK_TYPE_OPTIONS,
  getStatusOption,
  getPriorityOption,
  getEnergyOption,
  getMysteryOption,
  getBatteryOption,
  getTaskStatusOption,
  getProjectStatusOption,
  getTaskTypeOption,
  calculateTimeRange,
  formatMinutes,
  type TaskStatusValue,
  type ProjectStatusValue,
  type TaskTypeValue,
} from '@/lib/config/task-fields';
