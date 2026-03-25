'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChevronRight, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { useAuth } from '@/lib/hooks/use-auth';
import { apiClient } from '@/lib/api/client';

interface NavItem {
  name: string;
  href: string;
  emoji: string;
}

interface NavSection {
  title: string;
  emoji: string;
  items: NavItem[];
  defaultOpen?: boolean;
}

function NavLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg font-medium transition-colors',
        isActive
          ? 'bg-primary/10 text-primary border-l-[3px] border-primary'
          : 'text-text-main hover:bg-black/5 border-l-[3px] border-transparent'
      )}
    >
      <span className="text-xl">{item.emoji}</span>
      <span className="text-sm">{item.name}</span>
    </Link>
  );
}

function CollapsibleSection({
  section,
  pathname,
}: {
  section: NavSection;
  pathname: string;
}) {
  const [isOpen, setIsOpen] = useState(section.defaultOpen ?? false);

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-text-sub uppercase tracking-wider hover:bg-black/5 rounded-lg text-left"
      >
        <ChevronRight
          className={cn(
            'h-4 w-4 transition-transform',
            isOpen && 'rotate-90'
          )}
        />
        {section.emoji} {section.title}
      </button>
      {isOpen && (
        <div className="pl-4 space-y-0.5 mt-1 border-l border-border-warm ml-4">
          {section.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-colors',
                pathname.startsWith(item.href)
                  ? 'text-primary font-medium'
                  : 'text-text-sub hover:text-text-main hover:bg-black/5'
              )}
            >
              <span className="w-5 text-center">{item.emoji}</span>
              {item.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { t, isAwesome } = useTerminology();
  const { isPmOrAdmin, isTech } = useAuth();

  // Dynamic navigation based on terminology preference
  const mainNav: NavItem[] = [
    { name: t('dashboard'), href: '/dashboard', emoji: '🏔️' },
    { name: 'Timekeeper', href: '/time', emoji: '⏱️' },
  ];

  // Tech users don't see projects list - they access projects via task links
  const workSection: NavSection = {
    title: t('foundry'),
    emoji: '🔥',
    defaultOpen: true,
    items: [
      // Only show projects list for PM/Admin
      ...(isPmOrAdmin ? [{ name: t('projects'), href: '/projects', emoji: '🤝' }] : []),
      { name: t('clients'), href: '/clients', emoji: '🧑‍🚀' },
      { name: t('sites'), href: '/sites', emoji: '🏰' },
      { name: t('domains'), href: '/domains', emoji: '🔗' },
      { name: t('tasks'), href: '/tasks', emoji: '⚔️' },
      { name: t('tools'), href: '/tools', emoji: '🔨' },
    ],
  };

  // Parley section - PM/Admin only
  const parleySection: NavSection = {
    title: t('parley'),
    emoji: '🤝',
    defaultOpen: true,
    items: [
      { name: t('deals'), href: '/deals', emoji: '📋' },
      { name: t('meetings'), href: '/meetings', emoji: '📅' },
      { name: t('retainers'), href: '/charters', emoji: '📜' },
      { name: t('products'), href: '/deals/wares', emoji: '📦' },
      { name: 'MSA', href: '/deals/msa', emoji: '📄' },
      { name: 'Automation', href: '/deals/automation', emoji: '⚡' },
    ],
  };

  const knowledgeSection: NavSection = {
    title: t('grimoire'),
    emoji: '📖',
    items: [
      { name: t('sops'), href: '/sops', emoji: '📜' },
      { name: t('recipes'), href: '/recipes', emoji: '🧪' },
    ],
  };

  const adminSection: NavSection = {
    title: 'Admin',
    emoji: '🔐',
    items: [
      { name: 'Billing', href: '/billing', emoji: '💰' },
      { name: 'Team', href: '/admin/team', emoji: '👥' },
      { name: 'Functions', href: '/admin/functions', emoji: '💼' },
      { name: 'Hosting Plans', href: '/admin/hosting-plans', emoji: '🏠' },
      { name: 'Maintenance', href: '/admin/maintenance-plans', emoji: '🔧' },
      { name: 'Integrations', href: '/admin/integrations', emoji: '🔌' },
      { name: 'Database', href: '/admin/database', emoji: '💾' },
      { name: 'Reports', href: '/settings/reports', emoji: '📊' },
      { name: 'Settings', href: '/admin/settings', emoji: '⚙️' },
    ],
  };

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    apiClient.markLoggedOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-[240px] lg:flex-col">
      <div className="flex flex-col flex-grow bg-background-light border-r border-border-warm overflow-hidden">
        {/* Logo - h-14 matches main Header height */}
        <div className="flex h-14 shrink-0 items-center gap-3 px-4 border-b border-border-warm">
          <Image
            src="/logo.png"
            alt="Indelible"
            width={28}
            height={28}
            className="opacity-80"
          />
          <h1 className="text-lg font-bold text-text-main tracking-tight">
            Indelible
          </h1>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1">
          {/* Main navigation */}
          <nav className="space-y-1 mb-6">
            {mainNav.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                isActive={pathname.startsWith(item.href)}
              />
            ))}
          </nav>

          {/* Collapsible sections */}
          <CollapsibleSection section={workSection} pathname={pathname} />
          {isPmOrAdmin && (
            <CollapsibleSection section={parleySection} pathname={pathname} />
          )}
          <CollapsibleSection section={knowledgeSection} pathname={pathname} />

          {/* Settings */}
          <nav className="space-y-1 mt-6">
            <NavLink
              item={{ name: 'Settings', href: '/settings', emoji: '⚙️' }}
              isActive={pathname === '/settings'}
            />
          </nav>

          {/* Admin section - PM/Admin only */}
          {isPmOrAdmin && (
            <CollapsibleSection section={adminSection} pathname={pathname} />
          )}
        </div>

        {/* User section */}
        <div className="p-3 border-t border-border-warm bg-background-light">
          <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface border border-transparent hover:border-border-warm hover:shadow-sm transition-all cursor-pointer group">
            <div className="h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <span className="text-sm font-medium text-primary">U</span>
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <p className="text-sm font-semibold text-text-main truncate">
                User
              </p>
              <p className="text-xs text-text-sub truncate">Tech</p>
            </div>
            <button
              onClick={handleLogout}
              className="text-text-sub hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Sign Out"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
