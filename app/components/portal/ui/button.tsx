import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'quiet';

type Common = {
  variant?: Variant;
  icon?: LucideIcon;
  busy?: boolean;
  busyLabel?: string;
  children: React.ReactNode;
  className?: string;
};

// A 44px target. Links and buttons share one look; `href` makes it a link.
export function PortalButton(
  props: Common &
    (
      | ({ href: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children' | 'className'>)
      | ({ href?: undefined } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>)
    ),
) {
  const { variant = 'primary', icon: Icon, busy, busyLabel, children, className, ...rest } = props;
  const cls = `btn btn-${variant}${className ? ` ${className}` : ''}`;
  const content = (
    <>
      {Icon ? <Icon className="i" aria-hidden="true" focusable="false" /> : null}
      {busy && busyLabel ? busyLabel : children}
    </>
  );
  if ('href' in rest && rest.href !== undefined) {
    const { href, ...a } = rest as { href: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <Link href={href} className={cls} {...a}>
        {content}
      </Link>
    );
  }
  const { type = 'button', disabled, ...b } = rest as React.ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type={type} className={cls} disabled={disabled || busy} aria-busy={busy || undefined} {...b}>
      {content}
    </button>
  );
}
