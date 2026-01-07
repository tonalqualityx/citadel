'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { formatHours } from '@/lib/calculations/energy';

type BatteryLevel = 'full' | 'mid' | 'depleted';

interface FocusTargetMeterProps {
  availableHours: number;
  onAvailableHoursChange: (hours: number) => void;
  batteryLevel: BatteryLevel;
  onBatteryLevelChange: (level: BatteryLevel) => void;
  estimatedMinutesLow: number;
  estimatedMinutesHigh: number;
}

const BATTERY_OPTIONS: { value: BatteryLevel; label: string }[] = [
  { value: 'full', label: '⚡ Full' },
  { value: 'mid', label: '🔋 Mid' },
  { value: 'depleted', label: '🪫 Depleted' },
];

function getSelectedEstimate(low: number, high: number, battery: BatteryLevel): number {
  const avg = (low + high) / 2;
  switch (battery) {
    case 'full':
      return low;
    case 'mid':
      return avg;
    case 'depleted':
      return high;
  }
}

export function FocusTargetMeter({
  availableHours,
  onAvailableHoursChange,
  batteryLevel,
  onBatteryLevelChange,
  estimatedMinutesLow,
  estimatedMinutesHigh,
}: FocusTargetMeterProps) {
  const [hoursInputValue, setHoursInputValue] = React.useState(availableHours.toString());
  const batterySelectId = React.useId();

  // Sync input value when availableHours changes (e.g., from localStorage hydration)
  React.useEffect(() => {
    setHoursInputValue(availableHours.toString());
  }, [availableHours]);

  const handleHoursInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setHoursInputValue(e.target.value);
  };

  const handleHoursInputBlur = () => {
    const parsed = parseFloat(hoursInputValue);
    if (!isNaN(parsed) && parsed >= 0.5 && parsed <= 12) {
      onAvailableHoursChange(parsed);
    } else {
      setHoursInputValue(availableHours.toString());
    }
  };

  const handleHoursKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  // Calculate values
  const availableMinutes = availableHours * 60;
  const hasEstimates = estimatedMinutesLow > 0 || estimatedMinutesHigh > 0;
  const selectedMinutes = getSelectedEstimate(estimatedMinutesLow, estimatedMinutesHigh, batteryLevel);
  const avgMinutes = (estimatedMinutesLow + estimatedMinutesHigh) / 2;

  // Calculate percentages for the bar (relative to available capacity)
  const lowPercent = availableMinutes > 0 ? (estimatedMinutesLow / availableMinutes) * 100 : 0;
  const highPercent = availableMinutes > 0 ? (estimatedMinutesHigh / availableMinutes) * 100 : 0;
  const selectedPercent = availableMinutes > 0 ? (selectedMinutes / availableMinutes) * 100 : 0;

  // Determine status and message based on selected estimate
  let status: 'comfortable' | 'balanced' | 'over' = 'comfortable';
  let message = 'Comfortable - you have capacity for more';
  let statusColor = 'text-green-500';

  if (selectedPercent > 100) {
    status = 'over';
    const overBy = formatHours(selectedMinutes - availableMinutes);
    message = `Likely over by ~${overBy} at current energy`;
    statusColor = 'text-red-500';
  } else if (selectedPercent >= 80) {
    status = 'balanced';
    message = 'Good balance - close to your target';
    statusColor = 'text-amber-500';
  }

  // Get bar color based on status
  const getBarColor = () => {
    switch (status) {
      case 'over':
        return 'bg-red-500';
      case 'balanced':
        return 'bg-amber-500';
      default:
        return 'bg-green-500';
    }
  };

  // Empty state
  if (!hasEstimates) {
    return (
      <div className="mb-4 p-3 rounded-lg bg-surface-2">
        {/* Header row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
          {/* Battery selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-sub">My Battery:</span>
            <div className="relative">
              <select
                id={batterySelectId}
                value={batteryLevel}
                onChange={(e) => onBatteryLevelChange(e.target.value as BatteryLevel)}
                className="h-9 pl-3 pr-8 rounded-lg border border-border-warm bg-surface text-sm text-text-main appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
                title="Select energy level"
              >
                {BATTERY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-text-sub pointer-events-none" />
            </div>
          </div>

          {/* Available hours input */}
          <div className="flex items-center gap-1">
            <span className="text-sm text-text-sub">Available:</span>
            <input
              type="number"
              value={hoursInputValue}
              onChange={handleHoursInputChange}
              onBlur={handleHoursInputBlur}
              onKeyDown={handleHoursKeyDown}
              min={0.5}
              max={12}
              step={0.5}
              className="w-14 h-9 px-2 text-sm text-right bg-surface border border-border-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
            />
            <span className="text-sm text-text-sub">hrs</span>
          </div>
        </div>

        <p className="text-sm text-text-sub italic">
          Add tasks to your focus list to see capacity
        </p>
      </div>
    );
  }

  return (
    <div className="mb-4 p-3 rounded-lg bg-surface-2">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
        {/* Battery selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-sub">My Battery:</span>
          <div className="relative">
            <select
              id={`${batterySelectId}-main`}
              value={batteryLevel}
              onChange={(e) => onBatteryLevelChange(e.target.value as BatteryLevel)}
              className="h-9 pl-3 pr-8 rounded-lg border border-border-warm bg-surface text-sm text-text-main appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
              title="Select energy level"
            >
              {BATTERY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-text-sub pointer-events-none" />
          </div>
        </div>

        {/* Available hours input */}
        <div className="flex items-center gap-1">
          <span className="text-sm text-text-sub">Available:</span>
          <input
            type="number"
            value={hoursInputValue}
            onChange={handleHoursInputChange}
            onBlur={handleHoursInputBlur}
            onKeyDown={handleHoursKeyDown}
            min={0.5}
            max={12}
            step={0.5}
            className="w-14 h-9 px-2 text-sm text-right bg-surface border border-border-warm rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
          />
          <span className="text-sm text-text-sub">hrs</span>
        </div>
      </div>

      {/* Progress bar container */}
      <div className="relative mb-2">
        {/* Bar background (0 to capacity) */}
        <div className="h-4 bg-surface rounded-full overflow-visible relative">
          {/* Range band showing potential extent (0 to high) - faded */}
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all ${getBarColor()}`}
            style={{
              width: `${Math.min(highPercent, 100)}%`,
              opacity: 0.3,
            }}
          />
          {/* Filled portion up to selected estimate - solid */}
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all ${getBarColor()}`}
            style={{ width: `${Math.min(selectedPercent, 100)}%` }}
          />
          {/* Overflow indicator if over capacity */}
          {highPercent > 100 && (
            <div
              className="absolute inset-y-0 bg-red-500/50 rounded-r-full"
              style={{
                left: '100%',
                width: `${Math.min(highPercent - 100, 30)}%`,
              }}
            />
          )}
        </div>
        {/* Capacity marker at 100% */}
        <div className="absolute top-0 bottom-0 right-0 w-0.5 bg-text-sub/30" />
      </div>

      {/* Labels row */}
      <div className="flex items-center justify-between text-xs mb-2">
        <span className="text-text-sub">0</span>
        <span className="text-text-sub">{availableHours}h capacity</span>
      </div>

      {/* Estimate labels */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="text-text-sub">
          Low: <span className={`font-medium ${batteryLevel === 'full' ? statusColor : 'text-text-main'}`}>
            {formatHours(estimatedMinutesLow)}
          </span>
          {batteryLevel === 'full' && <span className="ml-1 text-text-sub/70">(selected)</span>}
        </span>
        <span className="text-text-sub">
          Avg: <span className={`font-medium ${batteryLevel === 'mid' ? statusColor : 'text-text-main'}`}>
            {formatHours(avgMinutes)}
          </span>
          {batteryLevel === 'mid' && <span className="ml-1 text-text-sub/70">(selected)</span>}
        </span>
        <span className="text-text-sub">
          High: <span className={`font-medium ${batteryLevel === 'depleted' ? statusColor : 'text-text-main'}`}>
            {formatHours(estimatedMinutesHigh)}
          </span>
          {batteryLevel === 'depleted' && <span className="ml-1 text-text-sub/70">(selected)</span>}
        </span>
      </div>

      {/* Status message */}
      <div className={`mt-2 text-sm ${statusColor}`}>
        {status === 'over' && '⚠️ '}
        {message}
      </div>
    </div>
  );
}
