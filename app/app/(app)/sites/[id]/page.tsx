'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Globe } from 'lucide-react';
import { useSite } from '@/lib/hooks/use-sites';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';

interface Props {
  params: Promise<{ id: string }>;
}

export default function SiteDetailPage({ params }: Props) {
  const { id } = use(params);
  const { t } = useTerminology();
  const { data: site, isLoading, error } = useSite(id);

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
      <div className="flex items-center gap-4">
        <Link href="/sites">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-main flex items-center gap-3">
            <Globe className="h-6 w-6" />
            {site.name}
          </h1>
          {site.url && (
            <a href={site.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              {site.url}
            </a>
          )}
        </div>
        <Button>Edit {t('site')}</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('client')}</CardTitle>
          </CardHeader>
          <CardContent>
            {site.client ? (
              <Link href={`/clients/${site.client.id}`} className="text-primary hover:underline">
                {site.client.name}
              </Link>
            ) : (
              <span className="text-text-sub">No client assigned</span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Domains</CardTitle>
          </CardHeader>
          <CardContent>
            {site.domains && site.domains.length > 0 ? (
              <ul className="space-y-1">
                {site.domains.map((domain: any) => (
                  <li key={domain.id}>
                    <Link href={`/domains/${domain.id}`} className="text-primary hover:underline">
                      {domain.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-text-sub">No domains</span>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
