'use client';

import * as React from 'react';
import { DollarSign, Clock, Users, FileText } from 'lucide-react';
import { useUnbilledItems } from '@/lib/hooks/use-billing';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { ClientBillingSection } from './client-billing-section';
import { minutesToDecimalHours } from '@/lib/utils/time';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatHours(minutes: number): string {
  const hours = minutesToDecimalHours(minutes);
  return `${hours} hr${hours !== 1 ? 's' : ''}`;
}

interface SummaryCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  subtitle?: string;
}

function SummaryCard({ title, value, icon, subtitle }: SummaryCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-text-sub">{title}</p>
            <p className="text-2xl font-semibold text-text-main mt-1">{value}</p>
            {subtitle && (
              <p className="text-xs text-text-sub mt-1">{subtitle}</p>
            )}
          </div>
          <div className="p-2 bg-primary/10 rounded-lg text-primary">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function BillingDashboard() {
  const { data, isLoading, error } = useUnbilledItems();

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<FileText className="h-12 w-12" />}
              title="Error loading billing data"
              description="There was a problem loading unbilled items. Please try again."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const { byClient, summary } = data || { byClient: [], summary: { totalMilestoneAmount: 0, totalTaskMinutes: 0, clientCount: 0 } };

  // Count total milestones and tasks
  const totalMilestones = byClient.reduce((sum, client) => sum + client.milestones.length, 0);
  const totalTasks = byClient.reduce((sum, client) => sum + client.tasks.length, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-text-main">Billing</h1>
        <p className="text-text-sub">Review and invoice unbilled milestones and tasks</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Unbilled Milestones"
          value={formatCurrency(summary.totalMilestoneAmount)}
          icon={<DollarSign className="h-5 w-5" />}
          subtitle={`${totalMilestones} milestone${totalMilestones !== 1 ? 's' : ''}`}
        />
        <SummaryCard
          title="Unbilled Task Hours"
          value={formatHours(summary.totalTaskMinutes)}
          icon={<Clock className="h-5 w-5" />}
          subtitle={`${totalTasks} task${totalTasks !== 1 ? 's' : ''}`}
        />
        <SummaryCard
          title="Clients with Unbilled"
          value={String(summary.clientCount)}
          icon={<Users className="h-5 w-5" />}
        />
        <SummaryCard
          title="Total Items"
          value={String(totalMilestones + totalTasks)}
          icon={<FileText className="h-5 w-5" />}
          subtitle="Ready to invoice"
        />
      </div>

      {/* Client Sections */}
      {byClient.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={<DollarSign className="h-12 w-12" />}
              title="All caught up!"
              description="There are no unbilled milestones or completed tasks to invoice."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {byClient.map((clientData) => (
            <ClientBillingSection
              key={clientData.clientId}
              clientData={clientData}
            />
          ))}
        </div>
      )}
    </div>
  );
}
