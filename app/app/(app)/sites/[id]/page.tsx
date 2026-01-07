'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Globe, Wrench, CheckCircle, ExternalLink, Trash2 } from 'lucide-react';
import { useSite, useUpdateSite, useDeleteSite } from '@/lib/hooks/use-sites';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { useAuth } from '@/lib/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@/components/ui/modal';
import { InlineUserSelect } from '@/components/ui/user-select';
import {
  InlineText,
  InlineTextarea,
  InlineSelect,
  HostingPlanSelect,
  MaintenancePlanSelect,
  ClientSelect,
} from '@/components/ui/inline-edit';
import { SiteDomainsCard } from '@/components/domain/sites/site-domains-card';
import { showToast } from '@/lib/hooks/use-toast';
import type { UpdateSiteInput, HostedBy } from '@/types/entities';

interface Props {
  params: Promise<{ id: string }>;
}

const HOSTED_BY_OPTIONS = [
  { value: 'indelible', label: 'Indelible' },
  { value: 'client', label: 'Client' },
  { value: 'other', label: 'Other' },
];

export default function SiteDetailPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const { t } = useTerminology();
  const { isPmOrAdmin } = useAuth();
  const { data: site, isLoading, error } = useSite(id);
  const updateSite = useUpdateSite();
  const deleteSite = useDeleteSite();
  const [isDeleteOpen, setIsDeleteOpen] = React.useState(false);

  const handleUpdate = async (updates: UpdateSiteInput) => {
    if (!site) return;
    try {
      await updateSite.mutateAsync({ id: site.id, data: updates });
    } catch (err) {
      console.error('Failed to update site:', err);
    }
  };

  const handleDelete = async () => {
    if (!site) return;
    try {
      await deleteSite.mutateAsync(site.id);
      showToast.deleted(t('site'));
      router.push('/sites');
    } catch (err) {
      showToast.apiError(err, `Failed to delete ${t('site').toLowerCase()}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !site) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<Globe className="h-12 w-12" />}
              title={`${t('site')} not found`}
              action={
                <Link href="/sites">
                  <Button>Back to {t('sites')}</Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/sites">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        {isPmOrAdmin && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsDeleteOpen(true)}
            className="text-text-sub hover:text-red-500"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        )}
      </div>

      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-text-main flex items-center gap-3">
            <Globe className="h-6 w-6" />
            <InlineText
              value={site.name}
              onChange={(name) => name && handleUpdate({ name })}
              className="text-2xl font-semibold"
            />
          </h1>
          {site.primary_domain ? (
            <a
              href={`https://${site.primary_domain.name}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-sub hover:text-primary flex items-center gap-1"
            >
              https://{site.primary_domain.name}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="text-text-sub italic text-sm">No primary domain set</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Client */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('client')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ClientSelect
              value={site.client?.id || null}
              onChange={(client_id) => handleUpdate({ client_id })}
              placeholder="Select client..."
            />
            {site.client && (
              <Link href={`/clients/${site.client.id}`} className="text-sm text-primary hover:underline block">
                View client details
              </Link>
            )}
          </CardContent>
        </Card>

        {/* Hosted By */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hosted By</CardTitle>
          </CardHeader>
          <CardContent>
            <InlineSelect
              value={site.hosted_by}
              options={HOSTED_BY_OPTIONS}
              onChange={(value) => handleUpdate({ hosted_by: value as HostedBy })}
              placeholder="Select hosting..."
              allowClear={false}
            />
          </CardContent>
        </Card>

        {/* Platform */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Platform</CardTitle>
          </CardHeader>
          <CardContent>
            <InlineText
              value={site.platform}
              onChange={(platform) => handleUpdate({ platform })}
              placeholder="WordPress, Shopify, etc..."
            />
          </CardContent>
        </Card>

        {/* Hosting Plan */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hosting Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs font-medium text-text-sub block mb-1">Plan</label>
              <HostingPlanSelect
                value={site.hosting_plan_id}
                onChange={(hosting_plan_id) => handleUpdate({ hosting_plan_id })}
                placeholder="Select hosting plan..."
              />
            </div>
            {site.hosting_plan && (
              <>
                <div>
                  <label className="text-xs font-medium text-text-sub block mb-1">Discount</label>
                  <div className="flex items-center gap-1">
                    <span className="text-text-sub">$</span>
                    <InlineText
                      value={site.hosting_discount ? String(site.hosting_discount) : null}
                      onChange={(value) => handleUpdate({ hosting_discount: value ? parseFloat(value) : null })}
                      placeholder="0"
                      type="number"
                      className="w-20"
                    />
                    <span className="text-text-sub text-sm">/mo off</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-text-sub block mb-1">Effective Rate</label>
                  <div className="text-text-main">
                    ${(Number(site.hosting_plan.rate) - (site.hosting_discount || 0)).toFixed(2)}/mo
                    {site.hosting_discount && site.hosting_discount > 0 && (
                      <span className="text-xs text-text-sub ml-2 line-through">
                        ${Number(site.hosting_plan.rate).toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Domains - Inline management */}
        <SiteDomainsCard siteId={site.id} domains={site.domains || []} />
      </div>

      {/* Maintenance Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Maintenance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="text-sm font-medium text-text-sub block mb-2">Plan</label>
              <MaintenancePlanSelect
                value={site.maintenance_plan_id}
                onChange={(maintenance_plan_id) => handleUpdate({ maintenance_plan_id })}
                placeholder="Select maintenance plan..."
              />
              {site.maintenance_plan && (
                <div className="text-xs text-text-sub mt-1 capitalize">
                  {site.maintenance_plan.frequency?.replace('_', '-')}
                </div>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-text-sub block mb-2">Rate</label>
              <p className="text-text-main">
                {site.maintenance_plan?.rate ? (
                  `$${site.maintenance_plan.rate.toFixed(2)}/period`
                ) : (
                  <span className="text-text-sub">-</span>
                )}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-text-sub block mb-2">Maintainer</label>
              <InlineUserSelect
                value={site.maintenance_assignee_id}
                onChange={(assigneeId) => handleUpdate({ maintenance_assignee_id: assigneeId })}
                displayValue={site.maintenance_assignee?.name}
                placeholder="Assign maintainer"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <InlineTextarea
            value={site.notes}
            onChange={(notes) => handleUpdate({ notes })}
            placeholder="Click to add notes..."
            rows={4}
          />
        </CardContent>
      </Card>

      {/* Saving indicator */}
      {updateSite.isPending && (
        <div className="fixed bottom-4 right-4 bg-surface border border-border rounded-lg shadow-lg px-4 py-2 flex items-center gap-2">
          <Spinner size="sm" />
          <span className="text-sm text-text-sub">Saving...</span>
        </div>
      )}

      {/* Save success indicator */}
      {updateSite.isSuccess && !updateSite.isPending && (
        <div className="fixed bottom-4 right-4 bg-green-500/10 border border-green-500/20 rounded-lg shadow-lg px-4 py-2 flex items-center gap-2 animate-pulse">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-600">Saved</span>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <ModalContent size="sm">
          <ModalHeader>
            <ModalTitle>Delete {t('site')}?</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-text-sub mb-4">
              Are you sure you want to delete <span className="font-medium text-text-main">{site.name}</span>?
              This will also delete all associated domains. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setIsDeleteOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteSite.isPending}
              >
                {deleteSite.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}
