'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/hooks/use-auth';

// Minimal designer chrome. /auth/me is the only non-design route it calls (designers may call it).
export function DesignChrome({ role }: { role: string | null }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const effectiveRole = role ?? user?.role;
  const staff = effectiveRole === 'admin' || effectiveRole === 'pm';

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    apiClient.markLoggedOut();
    queryClient.clear();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border-warm bg-surface px-4">
      <Link href="/design" className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Indelible" className="h-7 w-auto" />
      </Link>
      <div className="ml-auto flex items-center gap-3 text-sm">
        {staff && (
          <Link href="/dashboard" className="text-text-sub hover:text-text-main">
            Back to Citadel
          </Link>
        )}
        {user && <span className="hidden text-text-main sm:inline">{user.name}</span>}
        <button type="button" onClick={signOut} className="min-h-[44px] px-2 text-text-sub hover:text-text-main sm:min-h-0">
          Sign out
        </button>
      </div>
    </header>
  );
}
