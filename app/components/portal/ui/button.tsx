'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { useViewAs } from '@/components/portal/view-as-context';
import { RequestLink } from '@/components/portal/request-link';
import { isRequestNewHref } from '@/lib/portal/request-token';
import { VIEW_AS_READ_ONLY_LINE } from '@/lib/portal/view-as-copy';

type Variant = 'primary' | 'secondary' | 'quiet';

type Common = {
  variant?: Variant;
  icon?: LucideIcon;
  busy?: boolean;
  busyLabel?: string;
  children: React.ReactNode;
  className?: string;
  /** This button changes something (approve, send, save). Switched off, with the read-only line, in an admin's view-as. */
  writes?: boolean;
};

// A 44px target. Links and buttons share one look; `href` makes it a link.
export function PortalButton(
  props: Common &
    (
      | ({ href: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children' | 'className'>)
      | ({ href?: undefined } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>)
    ),
) {
  const { variant = 'primary', icon: Icon, busy, busyLabel, children, className, writes, ...rest } = props;
  const viewAs = useViewAs();
  const readOnly = !!writes && !!viewAs;
  const cls = `btn btn-${variant}${className ? ` ${className}` : ''}`;
  const content = (
    <>
      {Icon ? <Icon className="i" aria-hidden="true" focusable="false" /> : null}
      {busy && busyLabel ? busyLabel : children}
    </>
  );
  if ('href' in rest && rest.href !== undefined) {
    const { href, ...a } = rest as { href: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>;
    const L = isRequestNewHref(href) ? RequestLink : Link;
    return (
      <L href={href} className={cls} {...a}>
        {content}
      </L>
    );
  }
  const { type = 'button', disabled, ...b } = rest as React.ButtonHTMLAttributes<HTMLButtonElement>;
  const button = (
    <button type={type} className={cls} disabled={disabled || busy || readOnly} aria-busy={busy || undefined} {...b}>
      {content}
    </button>
  );
  if (!readOnly) return button;
  return (
    <>
      {button}
      <span className="note" role="note" data-view-as-note>
        {VIEW_AS_READ_ONLY_LINE}
      </span>
    </>
  );
}
