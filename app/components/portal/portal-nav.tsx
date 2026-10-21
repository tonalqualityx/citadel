'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/portal/home', label: 'Home' },
  { href: '/portal/history', label: 'History' },
  { href: '/portal/book', label: 'Book a meeting' },
];

/** Paths where the signed-in nav makes sense. Sign-in and token pages (proposals, contracts) get none. */
const NAV_PREFIXES = ['/portal/home', '/portal/projects', '/portal/history', '/portal/book', '/portal/articles'];

export function PortalNav() {
  const pathname = usePathname() ?? '';
  if (!NAV_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  return (
    <nav aria-label="Portal" className="border-b border-border bg-surface px-6">
      <ul className="max-w-4xl mx-auto flex flex-wrap gap-x-6 gap-y-1 py-2 text-sm">
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
    </nav>
  );
}
