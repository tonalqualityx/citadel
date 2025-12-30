'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';

export interface ProjectHealthData {
  overallScore: number;
  status: 'healthy' | 'at-risk' | 'critical';
  alerts: string[];
  indicators?: {
    tasksOnTrack: number;
    estimateAccuracy: number;
    velocityTrend: number;
    blockageLevel: number;
  };
}

interface ProjectHealthBadgeProps {
  health: ProjectHealthData | null;
  size?: 'sm' | 'md';
  showScore?: boolean;
  className?: string;
}

const statusConfig = {
  healthy: {
    variant: 'success' as const,
    icon: CheckCircle,
    label: 'Healthy',
  },
  'at-risk': {
    variant: 'warning' as const,
    icon: AlertTriangle,
    label: 'At Risk',
  },
  critical: {
    variant: 'error' as const,
    icon: XCircle,
    label: 'Critical',
  },
};

function buildTooltipContent(health: ProjectHealthData): string {
  const parts: string[] = [`Score: ${health.overallScore}%`];

  if (health.indicators) {
    parts.push(`On track: ${health.indicators.tasksOnTrack}%`);
    if (health.indicators.blockageLevel > 0) {
      parts.push(`Blocked: ${health.indicators.blockageLevel}%`);
    }
  }

  if (health.alerts.length > 0) {
    parts.push(health.alerts.join(', '));
  }

  return parts.join(' | ');
}

export function ProjectHealthBadge({
  health,
  size = 'sm',
  showScore = false,
  className,
}: ProjectHealthBadgeProps) {
  if (!health) {
    return null;
  }

  const config = statusConfig[health.status];
  const Icon = config.icon;

  return (
    <Tooltip content={buildTooltipContent(health)}>
      <Badge
        variant={config.variant}
        className={cn(
          'cursor-help',
          size === 'sm' && 'text-xs px-1.5 py-0.5',
          className
        )}
      >
        <Icon className={cn('mr-1', size === 'sm' ? 'h-3 w-3' : 'h-4 w-4')} />
        {showScore ? `${health.overallScore}%` : config.label}
      </Badge>
    </Tooltip>
  );
}

// Compact dot indicator for list views
export function ProjectHealthDot({
  health,
  className,
}: {
  health: ProjectHealthData | null;
  className?: string;
}) {
  if (!health) {
    return null;
  }

  const colorClass = {
    healthy: 'bg-emerald-500',
    'at-risk': 'bg-amber-500',
    critical: 'bg-red-500',
  }[health.status];

  const label = statusConfig[health.status].label;
  const tooltip = `${label} (${health.overallScore}%)${health.alerts.length > 0 ? ` - ${health.alerts.join(', ')}` : ''}`;

  return (
    <Tooltip content={tooltip}>
      <span
        className={cn(
          'inline-block h-2.5 w-2.5 rounded-full cursor-help flex-shrink-0',
          colorClass,
          className
        )}
      />
    </Tooltip>
  );
}
