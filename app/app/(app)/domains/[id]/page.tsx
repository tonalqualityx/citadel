'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Link2 } from 'lucide-react';
import { useDomain } from '@/lib/hooks/use-domains';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';

interface Props {
  params: Promise<{ id: string }>;
}

export default function DomainDetailPage({ params }: Props) {
  const { id } = use(params);
  const { t } = useTerminology();
  const { data: domain, isLoading, error } = useDomain(id);

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
            {domain.name}
            {domain.is_primary && <Badge variant="purple">Primary</Badge>}
          </h1>
        </div>
        <Button>Edit Domain</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('site')}</CardTitle>
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

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Registrar</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-text-main">{domain.registrar || 'Not specified'}</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Expiration</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-text-main">
              {domain.expires_at ? new Date(domain.expires_at).toLocaleDateString() : 'Not specified'}
            </span>
          </CardContent>
        </Card>
      </div>

      {domain.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-text-main whitespace-pre-wrap">{domain.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
