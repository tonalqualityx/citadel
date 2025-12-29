'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { SopForm } from '@/components/domain/sops/sop-form';

export default function NewSopPage() {
  const { t } = useTerminology();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/sops">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-text-main">New {t('sop')}</h1>
        <p className="text-text-sub">Create a new standard operating procedure</p>
      </div>

      <SopForm />
    </div>
  );
}
