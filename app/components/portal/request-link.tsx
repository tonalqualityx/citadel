'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { withFreshToken } from '@/lib/portal/request-token';

// A link to the request page that stamps a fresh token at click time (the rendered href stays
// stable, so server and client markup match). Modified clicks fall through to the browser.
export function RequestLink({ href, onClick, ...rest }: React.ComponentProps<typeof Link>) {
  const router = useRouter();
  return (
    <Link
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        router.push(withFreshToken(String(href)));
      }}
    />
  );
}
