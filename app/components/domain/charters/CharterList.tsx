'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { CharterWithRelations, CharterStatus } from '@/types/entities';

interface CharterListProps {
  charters: CharterWithRelations[];
  onSelect: (id: string) => void;
}

const statusBadgeVariant: Record<CharterStatus, 'success' | 'warning' | 'error'> = {
  active: 'success',
  paused: 'warning',
  cancelled: 'error',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatBillingPeriod(period: string): string {
  return period === 'monthly' ? 'Monthly' : 'Annually';
}

export function CharterList({ charters, onSelect }: CharterListProps) {
  if (charters.length === 0) {
    return (
      <div className="text-center py-12 text-text-sub text-sm">
        No charters found.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-warm text-left">
            <th className="pb-3 pr-4 font-medium text-text-sub">Name</th>
            <th className="pb-3 pr-4 font-medium text-text-sub">Client</th>
            <th className="pb-3 pr-4 font-medium text-text-sub">Status</th>
            <th className="pb-3 pr-4 font-medium text-text-sub">Billing Period</th>
            <th className="pb-3 pr-4 font-medium text-text-sub text-right">Budget Hours</th>
            <th className="pb-3 font-medium text-text-sub">Start Date</th>
          </tr>
        </thead>
        <tbody>
          {charters.map((charter) => (
            <tr
              key={charter.id}
              className="border-b border-border-warm last:border-0 hover:bg-background-light transition-colors cursor-pointer"
              onClick={() => onSelect(charter.id)}
            >
              <td className="py-3 pr-4">
                <span className="font-medium text-text-main">{charter.name}</span>
              </td>
              <td className="py-3 pr-4 text-text-sub">
                {charter.client?.name ?? 'No client'}
              </td>
              <td className="py-3 pr-4">
                <Badge variant={statusBadgeVariant[charter.status]} size="sm">
                  {charter.status}
                </Badge>
              </td>
              <td className="py-3 pr-4 text-text-sub">
                {formatBillingPeriod(charter.billing_period)}
              </td>
              <td className="py-3 pr-4 text-text-sub text-right">
                {charter.budget_hours != null ? `${charter.budget_hours}h` : '--'}
              </td>
              <td className="py-3 text-text-sub">
                {formatDate(charter.start_date)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
