'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, Mail, Phone, Clock } from 'lucide-react';
import { useClient } from '@/lib/hooks/use-clients';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';

interface Props {
  params: Promise<{ id: string }>;
}

export default function ClientDetailPage({ params }: Props) {
  const { id } = use(params);
  const { t } = useTerminology();
  const { data: client, isLoading, error } = useClient(id);

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
            {client.name}
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <Badge
              variant={
                client.status === 'active'
                  ? 'success'
                  : client.status === 'delinquent'
                  ? 'warning'
                  : 'default'
              }
            >
              {client.status}
            </Badge>
            <span className="text-text-sub capitalize">
              {client.type.replace('_', ' ')}
            </span>
          </div>
        </div>
        <Button>Edit {t('client')}</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Contact Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {client.primary_contact && (
              <div className="flex items-center gap-3">
                <Building2 className="h-4 w-4 text-text-sub" />
                <span className="text-text-main">{client.primary_contact}</span>
              </div>
            )}
            {client.email && (
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-text-sub" />
                <a href={`mailto:${client.email}`} className="text-primary hover:underline">
                  {client.email}
                </a>
              </div>
            )}
            {client.phone && (
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-text-sub" />
                <span className="text-text-main">{client.phone}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Retainer Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Retainer</CardTitle>
          </CardHeader>
          <CardContent>
            {client.retainer_hours ? (
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-primary" />
                <div>
                  <div className="text-2xl font-semibold text-text-main">
                    {Number(client.retainer_hours)} hrs
                  </div>
                  <div className="text-sm text-text-sub">per month</div>
                </div>
              </div>
            ) : (
              <p className="text-text-sub">No retainer configured</p>
            )}
          </CardContent>
        </Card>

        {/* Quick Stats */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-text-sub">{t('sites')}</span>
              <span className="font-medium text-text-main">
                {client.sites_count ?? client.sites?.length ?? 0}
              </span>
            </div>
            {client.sub_clients_count !== undefined && client.sub_clients_count > 0 && (
              <div className="flex justify-between">
                <span className="text-text-sub">Sub-clients</span>
                <span className="font-medium text-text-main">
                  {client.sub_clients_count}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Notes */}
      {client.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-text-main whitespace-pre-wrap">{client.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
