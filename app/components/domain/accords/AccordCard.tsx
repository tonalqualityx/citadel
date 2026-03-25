'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useDraggable } from '@dnd-kit/core';
import { Package } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { useTerminology } from '@/lib/hooks/use-terminology';
import type { AccordWithRelations } from '@/types/entities';

interface AccordCardProps {
  accord: AccordWithRelations;
}

function formatCurrency(value: number | null): string {
  if (value == null) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function getDaysAtStatus(enteredAt: string): number {
  const entered = new Date(enteredAt);
  const now = new Date();
  const diff = now.getTime() - entered.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getDaysVariant(days: number): 'success' | 'warning' | 'error' {
  if (days < 7) return 'success';
  if (days <= 14) return 'warning';
  return 'error';
}

export function AccordCard({ accord }: AccordCardProps) {
  const router = useRouter();
  const { t } = useTerminology();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: accord.id,
  });

  const days = getDaysAtStatus(accord.entered_current_status_at);
  const daysVariant = getDaysVariant(days);
  const displayName = accord.client?.name || accord.lead_name || 'No contact';
  const itemsCount = (accord.charter_items_count ?? 0) + (accord.commission_items_count ?? 0) + (accord.keep_items_count ?? 0);

  const style: React.CSSProperties = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : {};

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={isDragging ? 'opacity-50 z-50' : ''}
    >
      <Card
        className="cursor-grab active:cursor-grabbing hover:border-primary/40 transition-colors"
        onClick={(e) => {
          // Only navigate if not dragging
          if (!isDragging) {
            e.stopPropagation();
            router.push(`/deals/${accord.id}`);
          }
        }}
      >
        <CardContent className="p-3 space-y-2">
          {/* Name */}
          <div className="font-medium text-text-main text-sm truncate">
            {accord.name}
          </div>

          {/* Client / Lead */}
          <div className="text-xs text-text-sub truncate">{displayName}</div>

          {/* Value and days row */}
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-semibold text-text-main">
                {formatCurrency(accord.total_value)}
              </span>
              {(accord.mrr ?? 0) > 0 && (
                <div className="text-xs text-text-sub">
                  {formatCurrency(accord.mrr || 0)}/mo
                </div>
              )}
            </div>
            <Badge variant={daysVariant} size="sm">
              {days}d
            </Badge>
          </div>

          {/* Bottom row: owner + line items */}
          <div className="flex items-center justify-between pt-1">
            {accord.owner ? (
              <Avatar
                src={accord.owner.avatar_url}
                name={accord.owner.name}
                size="xs"
              />
            ) : (
              <div />
            )}
            {itemsCount > 0 && (
              <div className="flex items-center gap-1 text-xs text-text-sub">
                <Package className="h-3 w-3" />
                <span>
                  {itemsCount} {t('products')}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
