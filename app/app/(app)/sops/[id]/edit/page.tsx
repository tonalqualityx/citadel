'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileText } from 'lucide-react';
import { useSop } from '@/lib/hooks/use-sops';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { SopForm } from '@/components/domain/sops/sop-form';

interface Props {
  params: Promise<{ id: string }>;
}

export default function SopEditPage({ params }: Props) {
  const { id } = use(params);
  const { t } = useTerminology();
  const { data, isLoading, error } = useSop(id);
  const sop = data?.sop;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !sop) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<FileText className="h-12 w-12" />}
              title={`${t('sop')} not found`}
              action={
                <Link href="/sops">
                  <Button>Back to {t('sops')}</Button>
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
        <Link href={`/sops/${id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-text-main">Edit {t('sop')}</h1>
        <p className="text-text-sub">{sop.title}</p>
      </div>

      <SopForm sop={sop} />
    </div>
  );
}
