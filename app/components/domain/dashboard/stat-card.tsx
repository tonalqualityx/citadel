'use client';

import * as React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  trend?: {
    direction: 'up' | 'down' | 'neutral';
    text: string;
  };
  variant?: 'default' | 'success' | 'warning' | 'danger';
  className?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  variant = 'default',
  className = '',
}: StatCardProps) {
  const variantStyles = {
    default: 'bg-surface-2',
    success: 'bg-emerald-500/10 border border-emerald-500/20',
    warning: 'bg-amber-500/10 border border-amber-500/20',
    danger: 'bg-red-500/10 border border-red-500/20',
  };

  const valueStyles = {
    default: 'text-text-main',
    success: 'text-emerald-500',
    warning: 'text-amber-500',
    danger: 'text-red-500',
  };

  return (
    <div className={`p-4 rounded-lg ${variantStyles[variant]} ${className}`}>
      <div className="flex items-center gap-2 text-text-sub mb-1">
        {Icon && <Icon className="h-4 w-4" />}
        <span className="text-sm">{label}</span>
      </div>
      <div className={`text-2xl font-semibold ${valueStyles[variant]}`}>{value}</div>
      {trend && (
        <div
          className={`text-xs mt-1 ${
            trend.direction === 'up'
              ? 'text-emerald-500'
              : trend.direction === 'down'
              ? 'text-red-500'
              : 'text-text-sub'
          }`}
        >
          {trend.text}
        </div>
      )}
    </div>
  );
}
