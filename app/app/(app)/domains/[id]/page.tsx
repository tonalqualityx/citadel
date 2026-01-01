'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Link2, CheckCircle } from 'lucide-react';
import { useDomain, useUpdateDomain } from '@/lib/hooks/use-domains';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import {
  InlineText,
  InlineTextarea,
  InlineDate,
  InlineSelect,
  DnsProviderSelect,
} from '@/components/ui/inline-edit';
import type { UpdateDomainInput, DomainOwnership } from '@/types/entities';

interface Props {
  params: Promise<{ id: string }>;
}

const OWNERSHIP_OPTIONS = [
  { value: 'indelible', label: 'Indelible' },
  { value: 'client', label: 'Client' },
];

export default function DomainDetailPage({ params }: Props) {
  const { id } = use(params);
  const { t } = useTerminology();
  const { data: domain, isLoading, error } = useDomain(id);
  const updateDomain = useUpdateDomain();

  const handleUpdate = async (updates: UpdateDomainInput) => {
    if (!domain) return;
    try {
      await updateDomain.mutateAsync({ id: domain.id, data: updates });
    } catch (err) {
      console.error('Failed to update domain:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !domain) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<Link2 className="h-12 w-12" />}
              title="Domain not found"
              action={
                <Link href="/domains">
                  <Button>Back to Domains</Button>
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
      <div className="flex items-center gap-4">
        <Link href="/domains">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-main flex items-center gap-3">
            <Link2 className="h-6 w-6" />
            <InlineText
              value={domain.name}
              onChange={(name) => name && handleUpdate({ name })}
              className="text-2xl font-semibold"
            />
            {domain.is_primary && <Badge variant="purple">Primary</Badge>}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={domain.is_primary}
              onChange={(e) => handleUpdate({ is_primary: e.target.checked })}
              className="rounded border-border"
            />
            Primary Domain
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Site - Read only */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('site')}</CardTitle>
          </CardHeader>
          <CardContent>
            {domain.site ? (
              <Link href={`/sites/${domain.site.id}`} className="text-primary hover:underline">
                {domain.site.name}
              </Link>
            ) : (
              <span className="text-text-sub">No site assigned</span>
            )}
          </CardContent>
        </Card>

        {/* Registrar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registrar</CardTitle>
          </CardHeader>
          <CardContent>
            <InlineText
              value={domain.registrar}
              onChange={(registrar) => handleUpdate({ registrar })}
              placeholder="Enter registrar..."
            />
          </CardContent>
        </Card>

        {/* Expiration Date */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Expiration</CardTitle>
          </CardHeader>
          <CardContent>
            <InlineDate
              value={domain.expires_at}
              onChange={(expires_at) => handleUpdate({ expires_at })}
              placeholder="Set expiration date..."
            />
          </CardContent>
        </Card>

        {/* Registered By */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registered By</CardTitle>
          </CardHeader>
          <CardContent>
            <InlineSelect
              value={domain.registered_by}
              options={OWNERSHIP_OPTIONS}
              onChange={(value) => handleUpdate({ registered_by: value as DomainOwnership | null })}
              placeholder="Who owns the registration..."
            />
          </CardContent>
        </Card>

        {/* DNS Provider */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">DNS Provider</CardTitle>
          </CardHeader>
          <CardContent>
            <DnsProviderSelect
              value={domain.dns_provider_id}
              onChange={(dns_provider_id) => handleUpdate({ dns_provider_id })}
              placeholder="Select DNS provider..."
            />
          </CardContent>
        </Card>

        {/* DNS Managed By */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">DNS Managed By</CardTitle>
          </CardHeader>
          <CardContent>
            <InlineSelect
              value={domain.dns_managed_by}
              options={OWNERSHIP_OPTIONS}
              onChange={(value) => handleUpdate({ dns_managed_by: value as DomainOwnership | null })}
              placeholder="Who manages DNS..."
            />
          </CardContent>
        </Card>
      </div>

      {/* Notes - Always shown, editable */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <InlineTextarea
            value={domain.notes}
            onChange={(notes) => handleUpdate({ notes })}
            placeholder="Click to add notes..."
            rows={4}
          />
        </CardContent>
      </Card>

      {/* Saving indicator */}
      {updateDomain.isPending && (
        <div className="fixed bottom-4 right-4 bg-surface border border-border rounded-lg shadow-lg px-4 py-2 flex items-center gap-2">
          <Spinner size="sm" />
          <span className="text-sm text-text-sub">Saving...</span>
        </div>
      )}

      {/* Save success indicator */}
      {updateDomain.isSuccess && !updateDomain.isPending && (
        <div className="fixed bottom-4 right-4 bg-green-500/10 border border-green-500/20 rounded-lg shadow-lg px-4 py-2 flex items-center gap-2 animate-pulse">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-600">Saved</span>
        </div>
      )}
    </div>
  );
}
