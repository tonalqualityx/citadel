'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, Mail, Phone, Clock, DollarSign, CheckCircle } from 'lucide-react';
import { useClient, useUpdateClient } from '@/lib/hooks/use-clients';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import {
  InlineText,
  InlineTextarea,
  InlineSelect,
  ClientSelect,
} from '@/components/ui/inline-edit';
import { ClientActivityTab } from '@/components/domain/clients/client-activity-tab';
import { ClientSitesTab } from '@/components/domain/clients/client-sites-tab';
import type { UpdateClientInput, ClientType, ClientStatus } from '@/types/entities';

interface Props {
  params: Promise<{ id: string }>;
}

const CLIENT_TYPE_OPTIONS = [
  { value: 'direct', label: 'Direct' },
  { value: 'agency_partner', label: 'Agency Partner' },
  { value: 'sub_client', label: 'Sub-Client' },
];

const CLIENT_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'delinquent', label: 'Delinquent' },
];

type TabType = 'details' | 'sites' | 'activity';

export default function ClientDetailPage({ params }: Props) {
  const { id } = use(params);
  const { t } = useTerminology();
  const [activeTab, setActiveTab] = useState<TabType>('details');
  const { data: client, isLoading, error } = useClient(id);
  const updateClient = useUpdateClient();

  const handleUpdate = async (updates: UpdateClientInput) => {
    if (!client) return;
    try {
      await updateClient.mutateAsync({ id: client.id, data: updates });
    } catch (err) {
      console.error('Failed to update client:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<Building2 className="h-12 w-12" />}
              title={`${t('client')} not found`}
              description="The requested client could not be found."
              action={
                <Link href="/clients">
                  <Button>Back to {t('clients')}</Button>
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
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/clients">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-main flex items-center gap-3">
            <Building2 className="h-6 w-6" />
            <InlineText
              value={client.name}
              onChange={(name) => name && handleUpdate({ name })}
              className="text-2xl font-semibold"
            />
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <InlineSelect
              value={client.status}
              options={CLIENT_STATUS_OPTIONS}
              onChange={(value) => handleUpdate({ status: value as ClientStatus })}
              allowClear={false}
              renderValue={(val, label) => (
                <Badge
                  variant={
                    val === 'active'
                      ? 'success'
                      : val === 'delinquent'
                      ? 'warning'
                      : 'default'
                  }
                >
                  {label}
                </Badge>
              )}
            />
            <InlineSelect
              value={client.type}
              options={CLIENT_TYPE_OPTIONS}
              onChange={(value) => handleUpdate({ type: value as ClientType })}
              allowClear={false}
              className="text-text-sub"
            />
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-border">
        <nav className="flex gap-4">
          <button
            type="button"
            onClick={() => setActiveTab('details')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'details'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-sub hover:text-text-main'
            }`}
          >
            Details
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sites')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'sites'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-sub hover:text-text-main'
            }`}
          >
            {t('sites')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('activity')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'activity'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-sub hover:text-text-main'
            }`}
          >
            Activity
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'details' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Contact Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Contact Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-text-sub block mb-1">Primary Contact</label>
                  <div className="flex items-center gap-3">
                    <Building2 className="h-4 w-4 text-text-sub" />
                    <InlineText
                      value={client.primary_contact}
                      onChange={(primary_contact) => handleUpdate({ primary_contact })}
                      placeholder="Add contact name..."
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-text-sub block mb-1">Email</label>
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-text-sub" />
                    <InlineText
                      value={client.email}
                      onChange={(email) => handleUpdate({ email })}
                      placeholder="Add email..."
                      type="email"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-text-sub block mb-1">Phone</label>
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-text-sub" />
                    <InlineText
                      value={client.phone}
                      onChange={(phone) => handleUpdate({ phone })}
                      placeholder="Add phone..."
                      type="tel"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Retainer Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Billing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-text-sub block mb-1">Retainer Hours</label>
                  <div className="flex items-center gap-3">
                    <Clock className="h-4 w-4 text-text-sub" />
                    <InlineText
                      value={client.retainer_hours ? String(client.retainer_hours) : null}
                      onChange={(value) => handleUpdate({ retainer_hours: value ? Number(value) : undefined })}
                      placeholder="No retainer"
                      type="number"
                    />
                    {client.retainer_hours && (
                      <span className="text-sm text-text-sub">hrs/mo</span>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-text-sub block mb-1">Hourly Rate</label>
                  <div className="flex items-center gap-3">
                    <DollarSign className="h-4 w-4 text-text-sub" />
                    <InlineText
                      value={client.hourly_rate ? String(client.hourly_rate) : null}
                      onChange={(value) => handleUpdate({ hourly_rate: value ? Number(value) : undefined })}
                      placeholder="Not set"
                      type="number"
                    />
                    {client.hourly_rate && (
                      <span className="text-sm text-text-sub">/hr</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Parent Agency (only for sub_client type) */}
          {client.type === 'sub_client' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Parent Agency</CardTitle>
              </CardHeader>
              <CardContent>
                <ClientSelect
                  value={client.parent_agency_id}
                  onChange={(parent_agency_id) => handleUpdate({ parent_agency_id: parent_agency_id || undefined })}
                  placeholder="Select parent agency..."
                  excludeId={client.id}
                  filterType="agency_partner"
                />
                {client.parent_agency && (
                  <div className="text-sm text-text-sub mt-2">
                    <Link href={`/clients/${client.parent_agency.id}`} className="text-primary hover:underline">
                      View {client.parent_agency.name}
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <InlineTextarea
                value={client.notes}
                onChange={(notes) => handleUpdate({ notes })}
                placeholder="Click to add notes..."
                rows={4}
              />
            </CardContent>
          </Card>
        </div>
      ) : activeTab === 'sites' ? (
        <ClientSitesTab clientId={id} />
      ) : (
        <ClientActivityTab clientId={id} />
      )}

      {/* Saving indicator */}
      {updateClient.isPending && (
        <div className="fixed bottom-4 right-4 bg-surface border border-border rounded-lg shadow-lg px-4 py-2 flex items-center gap-2">
          <Spinner size="sm" />
          <span className="text-sm text-text-sub">Saving...</span>
        </div>
      )}

      {/* Save success indicator */}
      {updateClient.isSuccess && !updateClient.isPending && (
        <div className="fixed bottom-4 right-4 bg-green-500/10 border border-green-500/20 rounded-lg shadow-lg px-4 py-2 flex items-center gap-2 animate-pulse">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-600">Saved</span>
        </div>
      )}
    </div>
  );
}
