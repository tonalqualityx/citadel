'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Search, LogOut, Menu } from 'lucide-react';
import { TimerWidget } from './timer-widget';
import { QuickTaskModal } from './quick-task-modal';
import { MobileNav } from './MobileNav';
import { NotificationBell } from '@/components/domain/notifications';
import { useAuth } from '@/lib/hooks/use-auth';
import { Avatar } from '@/components/ui/avatar';

export function Header() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    // Clear all cached data to prevent stale user info on next login
    queryClient.clear();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-x-4 border-b border-border-warm bg-surface px-4 shadow-sm sm:gap-x-6 sm:px-6 lg:px-8">
      {/* Mobile menu button */}
      <button
        onClick={() => setShowMobileMenu(true)}
        className="lg:hidden text-text-sub hover:text-text-main p-1 rounded hover:bg-background-light transition-colors"
      >
        <Menu className="h-6 w-6" />
      </button>

      {/* Mobile navigation drawer */}
      <MobileNav open={showMobileMenu} onClose={() => setShowMobileMenu(false)} />

      {/* Mobile logo */}
      <div className="lg:hidden flex items-center gap-2">
        <Image
          src="/logo.png"
          alt="Indelible"
          width={24}
          height={24}
          className="opacity-80"
        />
        <h1 className="text-lg font-bold text-text-main">Indelible</h1>
      </div>

      {/* Search trigger - opens command palette */}
      <div className="hidden md:flex flex-1 items-center">
        <button
          onClick={() => {
            // Dispatch keyboard event to open command palette
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
          }}
          className="relative w-full max-w-sm rounded-lg border-0 bg-background-light py-2 pl-10 pr-4 text-left text-sm text-text-sub shadow-inner transition-all hover:bg-background-light/80 focus:ring-2 focus:ring-primary/20"
        >
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-text-sub" />
          </div>
          <span>Search...</span>
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 rounded border border-border-warm bg-surface px-1.5 py-0.5 text-xs text-text-sub">
            <span className="text-xs">⌘</span>K
          </kbd>
        </button>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-x-4 lg:gap-x-6 ml-auto">
        {/* Quick Task */}
        <QuickTaskModal />

        {/* Timer */}
        <TimerWidget />

        {/* Notifications */}
        <NotificationBell />

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-x-2 p-2 text-text-sub hover:text-text-main rounded-lg hover:bg-background-light transition-colors"
          >
            <Avatar
              src={user?.avatar_url}
              name={user?.name || 'User'}
              size="md"
            />
          </button>

          {showUserMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowUserMenu(false)}
              />
              <div className="absolute right-0 mt-2 w-48 rounded-lg bg-surface py-1 shadow-lg ring-1 ring-black ring-opacity-5 z-20">
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center px-4 py-2 text-sm text-text-main hover:bg-background-light transition-colors"
                >
                  <LogOut className="mr-3 h-4 w-4" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
