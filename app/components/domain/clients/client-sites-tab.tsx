'use client';

import * as React from 'react';
import Link from 'next/link';
import { Globe, ExternalLink, Plus, X } from 'lucide-react';
import { useSites, useUpdateSite } from '@/lib/hooks/use-sites';
import { TaskList, type TaskListColumn } from '@/components/ui/task-list';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import {
  InlineText,
  HostingPlanSelect,
  MaintenancePlanSelect,
} from '@/components/ui/inline-edit';
import { AddSiteModal } from './add-site-modal';
import { showToast } from '@/lib/hooks/use-toast';
import type { SiteWithRelations, UpdateSiteInput } from '@/types/entities';

interface ClientSitesTabProps {
  clientId: string;
}

export function ClientSitesTab({ clientId }: ClientSitesTabProps) {
  const [isAddSiteOpen, setIsAddSiteOpen] = React.useState(false);
  const { data, isLoading } = useSites({ client_id: clientId, limit: 100 });
  const updateSite = useUpdateSite();

  const handleRemoveSite = async (siteId: string) => {
    try {
      await updateSite.mutateAsync({ id: siteId, data: { client_id: null } });
      showToast.success('Site removed from client');
    } catch (error) {
      showToast.apiError(error, 'Failed to remove site');
    }
  };

  const handleSiteUpdate = async (siteId: string, updates: Partial<SiteWithRelations>) => {
    // Map SiteWithRelations updates to UpdateSiteInput
    const updateData: UpdateSiteInput = {};
    if ('hosting_plan_id' in updates) updateData.hosting_plan_id = updates.hosting_plan_id;
    if ('hosting_discount' in updates) updateData.hosting_discount = updates.hosting_discount;
    if ('maintenance_plan_id' in updates) updateData.maintenance_plan_id = updates.maintenance_plan_id;

    try {
      await updateSite.mutateAsync({ id: siteId, data: updateData });
    } catch (err) {
      console.error('Failed to update site:', err);
    }
  };

  const columns: TaskListColumn<SiteWithRelations>[] = [
    {
      key: 'name',
      header: 'Site',
      width: '1.5fr',
      cell: (site) => (
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-text-sub flex-shrink-0" />
          <Link
            href={`/sites/${site.id}`}
            className="font-medium text-text-main hover:text-primary hover:underline truncate"
            onClick={(e) => e.stopPropagation()}
          >
            {site.name}
          </Link>
          {site.primary_domain && (
            <a
              href={`https://${site.primary_domain.name}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-sub hover:text-primary"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      ),
    },
    {
      key: 'domain',
      header: 'Primary Domain',
      width: '1fr',
      cell: (site) => {
        const primaryDomain = site.domains?.find((d) => d.is_primary) || site.domains?.[0];
        if (!primaryDomain) {
          return <span className="text-text-sub text-sm italic">No domain</span>;
        }
        return (
          <Link
            href={`/domains/${primaryDomain.id}`}
            className="text-sm text-text-main hover:text-primary hover:underline truncate block"
            onClick={(e) => e.stopPropagation()}
          >
            {primaryDomain.name}
          </Link>
        );
      },
    },
    {
      key: 'hosting_plan',
      header: 'Hosting Plan',
      width: '1fr',
      cell: (site, onUpdate) => (
        <div onClick={(e) => e.stopPropagation()}>
          <HostingPlanSelect
            value={site.hosting_plan_id}
            onChange={(hosting_plan_id) => onUpdate({ hosting_plan_id } as Partial<SiteWithRelations>)}
            placeholder="None"
          />
        </div>
      ),
    },
    {
      key: 'hosting_rate',
      header: 'Rate',
      width: '120px',
      cell: (site, onUpdate) => {
        if (!site.hosting_plan) {
          return <span className="text-text-sub text-sm">-</span>;
        }
        const planRate = site.hosting_plan.rate;
        const discount = site.hosting_discount || 0;
        const effectiveRate = planRate - discount;

        return (
          <div onClick={(e) => e.stopPropagation()} className="text-sm">
            {discount > 0 ? (
              <div className="flex flex-col">
                <span className="text-text-main">${effectiveRate.toFixed(2)}/mo</span>
                <span className="text-xs text-text-sub line-through">${planRate.toFixed(2)}</span>
              </div>
            ) : (
              <span className="text-text-main">${planRate.toFixed(2)}/mo</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'hosting_discount',
      header: 'Discount',
      width: '100px',
      cell: (site, onUpdate) => {
        if (!site.hosting_plan) {
          return <span className="text-text-sub text-sm">-</span>;
        }
        return (
          <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
            <span className="text-text-sub text-sm">$</span>
            <InlineText
              value={site.hosting_discount ? String(site.hosting_discount) : null}
              onChange={(value) => {
                const discount = value ? parseFloat(value) : null;
                onUpdate({ hosting_discount: discount } as Partial<SiteWithRelations>);
              }}
              placeholder="0"
              type="number"
              className="text-sm w-16"
            />
          </div>
        );
      },
    },
    {
      key: 'maintenance_plan',
      header: 'Maintenance Plan',
      width: '1fr',
      cell: (site, onUpdate) => (
        <div onClick={(e) => e.stopPropagation()}>
          <MaintenancePlanSelect
            value={site.maintenance_plan_id}
            onChange={(maintenance_plan_id) => onUpdate({ maintenance_plan_id } as Partial<SiteWithRelations>)}
            placeholder="None"
          />
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '50px',
      cell: (site) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleRemoveSite(site.id)}
            className="h-7 w-7 p-0 text-text-sub hover:text-red-500"
            title="Remove from client"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[200px]">
        <Spinner size="md" />
      </div>
    );
  }

  const sites = data?.sites || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-sub">
          {sites.length} site{sites.length !== 1 ? 's' : ''}
        </h3>
        <Button size="sm" onClick={() => setIsAddSiteOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Site
        </Button>
      </div>

      <TaskList<SiteWithRelations>
        tasks={sites}
        columns={columns}
        onTaskUpdate={handleSiteUpdate}
        onTaskClick={(site) => {
          window.location.href = `/sites/${site.id}`;
        }}
        emptyMessage="No sites for this client"
        showHeaders={true}
      />

      {/* Saving indicator */}
      {updateSite.isPending && (
        <div className="fixed bottom-4 right-4 bg-surface border border-border rounded-lg shadow-lg px-4 py-2 flex items-center gap-2 z-50">
          <Spinner size="sm" />
          <span className="text-sm text-text-sub">Saving...</span>
        </div>
      )}

      {/* Add Site Modal */}
      <AddSiteModal
        open={isAddSiteOpen}
        onOpenChange={setIsAddSiteOpen}
        clientId={clientId}
        existingSiteIds={sites.map((s) => s.id)}
      />
    </div>
  );
}
