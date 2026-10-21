'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { RequestWorkButton } from '@/components/portal/request-work-button';

const NAV = [
  { href: '/portal/home', label: 'Home' },
  { href: '/portal/projects', label: 'Projects' },
  { href: '/portal/retainer', label: 'Retainer' },
  { href: '/portal/requests', label: 'Requests' },
  { href: '/portal/history', label: 'History' },
  { href: '/portal/book', label: 'Book a meeting' },
];

/** Pages that only exist for a signed-in person: the nav is shown at once, without asking. */
const SIGNED_IN_PREFIXES = [
  '/portal/home',
  '/portal/projects',
  '/portal/retainer',
  '/portal/requests',
  '/portal/work',
  '/portal/history',
  '/portal/book',
  '/portal/articles',
  '/portal/select',
];

/** The sign-in pages never carry the nav. */
const isSignIn = (pathname: string) => pathname === '/portal/login' || pathname.startsWith('/portal/login/');

/**
 * Every other portal page can be opened by a signed-in person too: the approval page, the article
 * review, the proposal, contract, MSA, addendum and onboarding token pages. Those links also work
 * for someone with no session (a prospect reading a proposal), so for them the nav waits for proof
 * of a session: /api/portal/clients answers 200 only when there is one.
 */
function useSignedIn(pathname: string, assume: boolean): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (assume || isSignIn(pathname)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/portal/clients');
        if (!cancelled) setSignedIn(res.ok);
      } catch {
        if (!cancelled) setSignedIn(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, assume]);
  return assume || signedIn;
}

export function PortalNav() {
  const pathname = usePathname() ?? '';
  const assume = SIGNED_IN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const signedIn = useSignedIn(pathname, assume);
  if (isSignIn(pathname) || !signedIn) return null;
  return (
    <nav aria-label="Portal" className="border-b border-border bg-surface px-6">
      <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-2">
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={active ? 'font-semibold text-text-main' : 'text-text-secondary hover:text-text-main'}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <RequestWorkButton />
      </div>
    </nav>
  );
}
