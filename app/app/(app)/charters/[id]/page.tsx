'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Pause, Play, XCircle } from 'lucide-react';
import {
  useCharter,
  useUpdateCharterStatus,
} from '@/lib/hooks/use-charters';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CharterDetail } from '@/components/domain/charters/CharterDetail';
import { UsageTracker } from '@/components/domain/charters/UsageTracker';
import { MeetingList } from '@/components/domain/meetings/MeetingList';
import type { CharterStatus } from '@/types/entities';

const STATUS_COLORS: Record<CharterStatus, 'success' | 'warning' | 'error'> = {
  active: 'success',
  paused: 'warning',
  cancelled: 'error',
};

export default function CharterDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useTerminology();
  const id = params.id as string;

  const { data: charter, isLoading, error } = useCharter(id);
  const updateStatus = useUpdateCharterStatus();

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (error || !charter) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 mb-4">
          {error ? 'Failed to load charter' : 'Charter not found'}
        </p>
        <Button variant="secondary" onClick={() => router.push('/charters')}>
          Back to {t('retainers')}
        </Button>
      </div>
    );
  }

  const handleStatusChange = (newStatus: CharterStatus) => {
    updateStatus.mutate({ id: charter.id, status: newStatus });
  };

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/charters"
        className="inline-flex items-center gap-1.5 text-sm text-text-sub hover:text-text-main transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {t('retainers')}
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-text-main">{charter.name}</h1>
            <Badge variant={STATUS_COLORS[charter.status]} size="sm">
              {charter.status}
            </Badge>
          </div>
          {charter.client && (
            <p className="text-sm text-text-sub mt-1">
              {t('client')}: {charter.client.name}
            </p>
          )}
        </div>

        {/* Status actions */}
        <div className="flex items-center gap-2">
          {charter.status === 'active' && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleStatusChange('paused')}
                disabled={updateStatus.isPending}
              >
                <Pause className="h-4 w-4 mr-1.5" />
                Pause
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleStatusChange('cancelled')}
                disabled={updateStatus.isPending}
                className="text-red-600 hover:text-red-700"
              >
                <XCircle className="h-4 w-4 mr-1.5" />
                Cancel
              </Button>
            </>
          )}
          {charter.status === 'paused' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleStatusChange('active')}
              disabled={updateStatus.isPending}
            >
              <Play className="h-4 w-4 mr-1.5" />
              Reactivate
            </Button>
          )}
          {charter.status === 'cancelled' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleStatusChange('active')}
              disabled={updateStatus.isPending}
            >
              <Play className="h-4 w-4 mr-1.5" />
              Reactivate
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="wares">{t('products')}</TabsTrigger>
          <TabsTrigger value="commissions">Commissions</TabsTrigger>
          <TabsTrigger value="meetings">Meetings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="mt-4 space-y-6">
            <UsageTracker
              charterId={charter.id}
              budgetHours={charter.budget_hours}
            />
            <CharterDetail charter={charter} />
          </div>
        </TabsContent>

        <TabsContent value="schedule">
          <ScheduleTab tasks={charter.scheduled_tasks ?? []} />
        </TabsContent>

        <TabsContent value="wares">
          <WaresTab wares={charter.charter_wares ?? []} />
        </TabsContent>

        <TabsContent value="commissions">
          <CommissionsTab commissions={charter.charter_commissions ?? []} />
        </TabsContent>

        <TabsContent value="meetings">
          <MeetingList charterId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Schedule Tab ── */
import type { CharterScheduledTaskItem, CharterWareItem, CharterCommissionItem } from '@/types/entities';

function ScheduleTab({ tasks }: { tasks: CharterScheduledTaskItem[] }) {
  if (!tasks.length) {
    return (
      <div className="text-center py-12 text-text-sub">
        No scheduled tasks yet
      </div>
    );
  }

  return (
    <div className="mt-4 border border-border-warm rounded-lg overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-background-light border-b border-border-warm">
            <th className="text-left px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
              SOP
            </th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
              Cadence
            </th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-warm">
          {tasks.map((task) => (
            <tr key={task.id} className="hover:bg-surface/50 transition-colors">
              <td className="px-4 py-3 text-sm text-text-main">
                {task.sop?.title ?? 'Unknown SOP'}
              </td>
              <td className="px-4 py-3">
                <Badge size="sm">{task.cadence}</Badge>
              </td>
              <td className="px-4 py-3">
                <Badge
                  variant={task.is_active ? 'success' : 'error'}
                  size="sm"
                >
                  {task.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Wares Tab ── */
function WaresTab({ wares }: { wares: CharterWareItem[] }) {
  const { t } = useTerminology();

  if (!wares.length) {
    return (
      <div className="text-center py-12 text-text-sub">
        No {t('products').toLowerCase()} attached yet
      </div>
    );
  }

  return (
    <div className="mt-4 border border-border-warm rounded-lg overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-background-light border-b border-border-warm">
            <th className="text-left px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
              {t('product')}
            </th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
              Price
            </th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-warm">
          {wares.map((item) => (
            <tr key={item.id} className="hover:bg-surface/50 transition-colors">
              <td className="px-4 py-3 text-sm text-text-main">
                {item.ware ? (
                  <Link
                    href={`/deals/wares/${item.ware_id}`}
                    className="hover:text-primary transition-colors"
                  >
                    {item.ware.name}
                  </Link>
                ) : (
                  'Unknown'
                )}
              </td>
              <td className="px-4 py-3 text-sm text-text-main text-right">
                {formatCurrency(item.price)}
              </td>
              <td className="px-4 py-3">
                <Badge
                  variant={item.is_active ? 'success' : 'error'}
                  size="sm"
                >
                  {item.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCurrency(amount: number | null) {
  if (amount == null) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/* ── Commissions Tab ── */
function CommissionsTab({ commissions }: { commissions: CharterCommissionItem[] }) {
  if (!commissions.length) {
    return (
      <div className="text-center py-12 text-text-sub">
        No commissions linked yet
      </div>
    );
  }

  return (
    <div className="mt-4 border border-border-warm rounded-lg overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-background-light border-b border-border-warm">
            <th className="text-left px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
              Commission
            </th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
              Period
            </th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
              Hours/Period
            </th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-warm">
          {commissions.map((link) => (
            <tr key={link.id} className="hover:bg-surface/50 transition-colors">
              <td className="px-4 py-3 text-sm text-text-main">
                {link.commission ? (
                  <Link
                    href={`/projects/${link.commission_id}`}
                    className="hover:text-primary transition-colors"
                  >
                    {link.commission.name}
                  </Link>
                ) : (
                  'Unknown'
                )}
              </td>
              <td className="px-4 py-3 text-sm text-text-sub">
                {formatDate(link.start_period)}
                {link.end_period ? ` - ${formatDate(link.end_period)}` : ' - ongoing'}
              </td>
              <td className="px-4 py-3 text-sm text-text-main text-right">
                {link.allocated_hours_per_period != null
                  ? `${link.allocated_hours_per_period}h`
                  : '--'}
              </td>
              <td className="px-4 py-3">
                <Badge
                  variant={link.is_active ? 'success' : 'error'}
                  size="sm"
                >
                  {link.is_active ? 'Active' : 'Completed'}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
