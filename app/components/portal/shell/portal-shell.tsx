'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, LogOut, Plus } from 'lucide-react';
import { AccountBlock, usePortalSession } from '@/components/portal/client-switcher';
import { activeKey, isBarePath, NAV, type NavKey } from './nav-items';
import { HelpLine } from './help-line';
import { MoreSheet } from './more-sheet';
import { ThemeControl } from './theme-control';
import { Wordmark } from './wordmark';

const PHONE_SLOTS: NavKey[] = ['home', 'projects', 'retainer', 'requests'];

/**
 * The frame of every portal page. Wide screens get the navy sidebar; phones get a top bar, a bottom
 * bar and a More sheet. The sign-in, picker and token pages get the bare frame: the top bar only.
 */
export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const bare = isBarePath(pathname);
  const session = usePortalSession(!bare, pathname);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const active = activeKey(pathname);

  async function signOut() {
    try {
      await fetch('/api/portal/logout', { method: 'POST' });
    } finally {
      router.replace('/portal/login');
    }
  }

  if (bare) {
    return (
      <div className="shell shell-bare">
        <header className="topbar" data-nav-zone>
          <Wordmark />
        </header>
        <main className="main main-bare" id="main">
          <div className="bare-inner">{children}</div>
          <HelpLine />
        </main>
      </div>
    );
  }

  const phoneNav = NAV.filter((n) => PHONE_SLOTS.includes(n.key));
  const moreActive = active === 'history' || active === 'book';

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Portal" data-nav-zone>
        <div className="side-in">
          <Wordmark />
          <AccountBlock name={session.name} canSwitch={session.canSwitch} />
          <Link className="btn-nav" href="/portal/requests/new">
            <Plus className="i" aria-hidden="true" focusable="false" />
            Request work
          </Link>
          <nav className="snav" aria-label="Main">
            {NAV.map(({ key, href, label, icon: Icon }) => (
              <Link key={key} href={href} aria-current={active === key ? 'page' : undefined}>
                <Icon className="i" aria-hidden="true" focusable="false" />
                {label}
              </Link>
            ))}
          </nav>
          <div className="foot">
            <svg className="side-motif" viewBox="0 0 224 56" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <path d="M0 44 L28 30 L46 36 L72 18 L98 34 L124 22 L150 38 L178 16 L204 30 L224 24" />
              <path d="M0 52 C40 44 70 50 112 46 C150 42 190 52 224 46" />
            </svg>
            <ThemeControl />
            <button type="button" className="linklike" onClick={signOut}>
              <LogOut className="i" aria-hidden="true" focusable="false" />
              Sign out
            </button>
            <HelpLine />
          </div>
        </div>
      </aside>

      <div className="col">
        <header className="topbar" data-nav-zone>
          <Wordmark />
          <span className="who">{session.name}</span>
          <Link className="btn-nav" href="/portal/requests/new">
            <Plus className="i" aria-hidden="true" focusable="false" />
            Request
          </Link>
        </header>
        <main className="main" id="main">
          {session.moved ? (
            <p role="status" className="moved">
              You no longer have access to the account you were viewing, so we opened {session.name}.
            </p>
          ) : null}
          <div className="main-inner">{children}</div>
        </main>
        <nav className="bottombar" aria-label="Portal" data-nav-zone>
          {phoneNav.map(({ key, href, label, icon: Icon }) => (
            <Link key={key} href={href} aria-current={active === key ? 'page' : undefined}>
              <Icon className="i" aria-hidden="true" focusable="false" />
              {label}
            </Link>
          ))}
          <button
            type="button"
            ref={moreBtn}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            aria-current={moreActive ? 'page' : undefined}
            onClick={() => setMoreOpen(true)}
          >
            <Menu className="i" aria-hidden="true" focusable="false" />
            More
          </button>
        </nav>
        <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} canSwitch={session.canSwitch} onSignOut={signOut} returnFocusTo={moreBtn} />
      </div>
    </div>
  );
}
