'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LucideIcon } from 'lucide-react';

interface DashboardSectionProps {
  title: string;
  icon?: LucideIcon;
  /** Color class for the icon (e.g., 'text-amber-500') */
  iconColor?: string;
  count?: number;
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  /** Additional controls to render in the header (e.g., grouping dropdown) */
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function DashboardSection({
  title,
  icon: Icon,
  iconColor = 'text-text-sub',
  count,
  action,
  headerActions,
  children,
  className = '',
}: DashboardSectionProps) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          {Icon && <Icon className={`h-5 w-5 ${iconColor}`} />}
          {title}
          {count !== undefined && (
            <span className="text-sm font-normal text-text-sub">({count})</span>
          )}
        </CardTitle>
        <div className="flex items-center gap-2">
          {headerActions}
          {action && (
            action.href ? (
              <a href={action.href}>
                <Button variant="ghost" size="sm">
                  {action.label}
                </Button>
              </a>
            ) : (
              <Button variant="ghost" size="sm" onClick={action.onClick}>
                {action.label}
              </Button>
            )
          )}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
