'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, TriangleAlert } from 'lucide-react';
import { PageHeader } from '@/components/portal/ui/page-header';
import { Callout } from '@/components/portal/ui/callout';
import { EmptyState } from '@/components/portal/ui/empty-state';
import { PortalButton } from '@/components/portal/ui/button';
import { Skeleton, SkeletonRegion } from '@/components/portal/ui/skeleton';
import { RetainerCard, type RetainerCardView } from '@/components/portal/retainer-card';

// Retainer (portal phase B slice 2, redesign 7.4): one plan per active or paused charter. The plan
// name, the period, what is in flight this period, the plan year, the latest report, a plan
// waiting for approval, and the plan's allowance. Never hours used. Backed by GET /api/portal/retainer.

const BOOK = '/portal/book?type=marketing';

export default function PortalRetainerPage() {
  const router = useRouter();
  const [cards, setCards] = useState<RetainerCardView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/portal/retainer');
      if (res.status === 401) {
        router.replace('/portal/login');
        return;
      }
      if (!res.ok) {
        setError('Failed to load your retainer');
        return;
      }
      setCards((await res.json()).retainers);
    } catch {
      setError('Failed to load your retainer');
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <Callout tone="urgent" icon={TriangleAlert} title="Unable to load your retainer" note={`${error}. Refresh the page, and if it keeps happening, let us know.`} />
    );
  }
  if (!cards) {
    return (
      <SkeletonRegion label="Retainer">
        <div className="ph no-motif">
          <Skeleton lines={2} />
        </div>
        <Skeleton lines={4} block />
        <Skeleton lines={3} block />
      </SkeletonRegion>
    );
  }

  if (cards.length === 0) {
    return (
      <>
        <PageHeader title="Retainer" motif="contours" lede="Your monthly plan, reports and the work in progress." />
        <EmptyState
          art="field"
          title="No retainer on your account"
          body="When you have one, your monthly plan, reports and the work in progress show here."
          action={
            <PortalButton variant="primary" icon={CalendarDays} href={BOOK}>
              Book a meeting
            </PortalButton>
          }
        />
      </>
    );
  }

  return (
    <>
      {cards.map((c, i) => (
        <RetainerCard key={c.id} card={c} primary={i === 0} onChanged={load} />
      ))}
    </>
  );
}
