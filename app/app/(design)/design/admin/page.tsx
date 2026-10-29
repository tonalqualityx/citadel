'use client';

import Link from 'next/link';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/hooks/use-auth';
import { useAdminSettings } from '@/lib/hooks/use-design-admin';
import { AdminOverview } from '@/components/domain/design/AdminOverview';
import { AdminSettings } from '@/components/domain/design/AdminSettings';
import { BudgetsTable } from '@/components/domain/design/BudgetsTable';
import { SiteToggles } from '@/components/domain/design/SiteToggles';

export default function DesignAdminPage() {
  const { user, isLoading } = useAuth();
  const isAdmin = user?.role === 'admin';
  const staff = isAdmin || user?.role === 'pm';
  const settings = useAdminSettings(isAdmin);

  if (isLoading) return <Spinner />;
  if (!staff) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-sub">This page is for admins.</p>
        <Link href="/design" className="text-sm text-primary underline">Back to your quests</Link>
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header>
        <Link href="/design" className="text-sm text-text-sub hover:text-text-main">Back</Link>
        <h1 className="text-lg font-semibold text-text-main">Designer portal admin</h1>
      </header>
      <AdminOverview />
      <section aria-label="Settings" className="space-y-2">
        <h2 className="text-sm font-semibold text-text-main">Settings</h2>
        {isAdmin ? (
          settings.isLoading ? <Spinner /> : settings.data ? <AdminSettings settings={settings.data.settings} canWrite /> : <p className="text-sm text-text-sub">The settings could not be loaded.</p>
        ) : (
          <p className="text-sm text-text-sub">Only an admin can see the settings.</p>
        )}
      </section>
      <section aria-label="Sites" className="space-y-2">
        <h2 className="text-sm font-semibold text-text-main">Sites</h2>
        <SiteToggles canWrite={isAdmin} />
      </section>
      <section aria-label="Budgets" className="space-y-2">
        <h2 className="text-sm font-semibold text-text-main">Budgets</h2>
        <BudgetsTable canWrite={isAdmin} />
      </section>
    </div>
  );
}
