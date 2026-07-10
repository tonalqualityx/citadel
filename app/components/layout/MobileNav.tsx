'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { useAuth } from '@/lib/hooks/use-auth';

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
}

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

export function MobileNav({ open, onClose }: MobileNavProps) {
  const pathname = usePathname();
  const { t } = useTerminology();
  const { isPmOrAdmin, isAdmin } = useAuth();
  const initialPathname = useRef(pathname);

  // Close on route change (but not on initial mount)
  useEffect(() => {
    if (initialPathname.current !== pathname) {
      onClose();
      initialPathname.current = pathname;
    }
  }, [pathname, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);

  if (!open) return null;

  // Navigation items (same as Sidebar)
  const mainNav: NavItem[] = [
    { name: t('dashboard'), href: '/dashboard', emoji: '🏔️' },
    { name: 'Timekeeper', href: '/time', emoji: '⏱️' },
  ];

  const workSection: NavSection = {
    title: t('foundry'),
    emoji: '🔥',
    defaultOpen: true,
    items: [
      ...(isPmOrAdmin ? [{ name: t('projects'), href: '/projects', emoji: '🤝' }] : []),
      { name: t('clients'), href: '/clients', emoji: '🧑‍🚀' },
      { name: t('sites'), href: '/sites', emoji: '🏰' },
      { name: t('domains'), href: '/domains', emoji: '🔗' },
      { name: t('tasks'), href: '/tasks', emoji: '⚔️' },
      { name: t('tools'), href: '/tools', emoji: '🔨' },
    ],
  };

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

  // Literal, NOT run through useTerminology — mirrors the Troubador section's
  // literal title (Sidebar.tsx duplicates these nav literals; keep both in lockstep).
  const oracleSection: NavSection = {
    title: 'Oracle',
    emoji: '🔮',
    defaultOpen: true,
    items: [
      { name: 'Fleet', href: '/oracle', emoji: '🔮' },
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
    ],
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 left-0 z-50 flex w-[min(85vw,18rem)] flex-col bg-background-light shadow-xl lg:hidden animate-in slide-in-from-left duration-200">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between h-14 px-4 border-b border-border-warm">
          <span className="text-lg font-bold text-text-main">Menu</span>
          <button
            onClick={onClose}
            className="p-1 text-text-sub hover:text-text-main rounded hover:bg-surface transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Main nav */}
          <div className="space-y-1">
            {mainNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium transition-colors',
                  pathname.startsWith(item.href)
                    ? 'bg-primary/10 text-primary'
                    : 'text-text-main hover:bg-surface'
                )}
              >
                <span className="text-xl">{item.emoji}</span>
                <span>{item.name}</span>
              </Link>
            ))}
          </div>

          {/* Work section */}
          <NavSectionBlock section={workSection} pathname={pathname} />

          {/* Parley section - PM/Admin only */}
          {isPmOrAdmin && <NavSectionBlock section={parleySection} pathname={pathname} />}

          {/* Knowledge section */}
          <NavSectionBlock section={knowledgeSection} pathname={pathname} />

          {/* Oracle section - admin only (1.5a, was PM/Admin) */}
          {isAdmin && <NavSectionBlock section={oracleSection} pathname={pathname} />}

          {/* Settings */}
          <div className="space-y-1">
            <Link
              href="/settings"
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium transition-colors',
                pathname === '/settings'
                  ? 'bg-primary/10 text-primary'
                  : 'text-text-main hover:bg-surface'
              )}
            >
              <span className="text-xl">⚙️</span>
              <span>Settings</span>
            </Link>
          </div>

          {/* Admin section */}
          {isPmOrAdmin && <NavSectionBlock section={adminSection} pathname={pathname} />}
        </nav>
      </div>
    </>
  );
}

function NavSectionBlock({ section, pathname }: { section: NavSection; pathname: string }) {
  // Keep the section open by default if the active route lives in it, so
  // navigating here never hides the current page behind a collapsed header.
  const containsActiveRoute = section.items.some((item) => pathname.startsWith(item.href));
  const [isOpen, setIsOpen] = useState((section.defaultOpen ?? false) || containsActiveRoute);

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="flex w-full min-h-11 items-center gap-2 px-3 py-2 text-xs font-bold text-text-sub uppercase tracking-wider rounded-lg hover:bg-surface text-left"
      >
        <ChevronRight
          className={cn('h-4 w-4 shrink-0 transition-transform', isOpen && 'rotate-90')}
        />
        <span>
          {section.emoji} {section.title}
        </span>
      </button>
      {isOpen && (
        <div className="space-y-0.5 mt-0.5">
          {section.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                pathname.startsWith(item.href)
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-text-main hover:bg-surface'
              )}
            >
              <span className="w-6 text-center">{item.emoji}</span>
              <span>{item.name}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
