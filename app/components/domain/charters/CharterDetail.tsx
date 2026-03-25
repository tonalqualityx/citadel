'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type {
  CharterWithRelations,
  CharterStatus,
  CharterWareItem,
  CharterScheduledTaskItem,
  CharterCommissionItem,
} from '@/types/entities';

interface CharterDetailProps {
  charter: CharterWithRelations;
}

const statusBadgeVariant: Record<CharterStatus, 'success' | 'warning' | 'error'> = {
  active: 'success',
  paused: 'warning',
  cancelled: 'error',
};

function formatCurrency(value: number | null): string {
  if (value == null) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatBillingPeriod(period: string): string {
  return period === 'monthly' ? 'Monthly' : 'Annually';
}

export function CharterDetail({ charter }: CharterDetailProps) {
  return (
    <div className="space-y-6">
      {/* Charter Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{charter.name}</CardTitle>
            <Badge variant={statusBadgeVariant[charter.status]}>
              {charter.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt className="text-text-sub">Client</dt>
              <dd className="text-text-main font-medium mt-0.5">
                {charter.client ? (
                  <Link
                    href={`/clients/${charter.client.id}`}
                    className="hover:text-primary transition-colors"
                  >
                    {charter.client.name}
                  </Link>
                ) : (
                  'No client'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-text-sub">Billing Period</dt>
              <dd className="text-text-main font-medium mt-0.5">
                {formatBillingPeriod(charter.billing_period)}
              </dd>
            </div>
            <div>
              <dt className="text-text-sub">Budget Hours</dt>
              <dd className="text-text-main font-medium mt-0.5">
                {charter.budget_hours != null ? `${charter.budget_hours}h` : '--'}
              </dd>
            </div>
            <div>
              <dt className="text-text-sub">Hourly Rate</dt>
              <dd className="text-text-main font-medium mt-0.5">
                {formatCurrency(charter.hourly_rate)}
              </dd>
            </div>
            <div>
              <dt className="text-text-sub">Budget Amount</dt>
              <dd className="text-text-main font-medium mt-0.5">
                {formatCurrency(charter.budget_amount)}
              </dd>
            </div>
            <div>
              <dt className="text-text-sub">Start Date</dt>
              <dd className="text-text-main font-medium mt-0.5">
                {formatDate(charter.start_date)}
              </dd>
            </div>
            {charter.end_date && (
              <div>
                <dt className="text-text-sub">End Date</dt>
                <dd className="text-text-main font-medium mt-0.5">
                  {formatDate(charter.end_date)}
                </dd>
              </div>
            )}
            {charter.accord && (
              <div>
                <dt className="text-text-sub">Accord</dt>
                <dd className="text-text-main font-medium mt-0.5">
                  <Link
                    href={`/deals/${charter.accord.id}`}
                    className="hover:text-primary transition-colors"
                  >
                    {charter.accord.name}
                  </Link>
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Charter Wares */}
      {charter.charter_wares && charter.charter_wares.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Wares</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {charter.charter_wares.map((item: CharterWareItem) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between py-2 border-b border-border-warm last:border-0"
                >
                  <div>
                    {item.ware ? (
                      <Link
                        href={`/deals/wares/${item.ware_id}`}
                        className="text-sm font-medium text-text-main hover:text-primary transition-colors"
                      >
                        {item.ware.name}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium text-text-main">
                        Unknown ware
                      </span>
                    )}
                    {!item.is_active && (
                      <Badge variant="default" size="sm" className="ml-2">
                        Inactive
                      </Badge>
                    )}
                  </div>
                  <span className="text-sm text-text-sub">
                    {formatCurrency(item.price)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scheduled Tasks */}
      {charter.scheduled_tasks && charter.scheduled_tasks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Scheduled Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {charter.scheduled_tasks.map((task: CharterScheduledTaskItem) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between py-2 border-b border-border-warm last:border-0"
                >
                  <div>
                    <span className="text-sm font-medium text-text-main">
                      {task.sop?.title ?? 'Unknown SOP'}
                    </span>
                    {!task.is_active && (
                      <Badge variant="default" size="sm" className="ml-2">
                        Inactive
                      </Badge>
                    )}
                  </div>
                  <span className="text-sm text-text-sub capitalize">
                    {task.cadence}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Linked Commissions */}
      {charter.charter_commissions && charter.charter_commissions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Linked Commissions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {charter.charter_commissions.map((link: CharterCommissionItem) => (
                <div
                  key={link.id}
                  className="flex items-center justify-between py-2 border-b border-border-warm last:border-0"
                >
                  <div>
                    {link.commission ? (
                      <Link
                        href={`/projects/${link.commission_id}`}
                        className="text-sm font-medium text-text-main hover:text-primary transition-colors"
                      >
                        {link.commission.name}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium text-text-main">
                        Unknown commission
                      </span>
                    )}
                    {!link.is_active && (
                      <Badge variant="default" size="sm" className="ml-2">
                        Inactive
                      </Badge>
                    )}
                  </div>
                  <span className="text-sm text-text-sub">
                    {link.allocated_hours_per_period != null
                      ? `${link.allocated_hours_per_period}h/period`
                      : 'No allocation'}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
