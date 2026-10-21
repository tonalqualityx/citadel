import Link from 'next/link';

// The "Request work" entry point. Every one goes to /portal/requests/new; the server re-checks
// any prefill (type, site, project) it is given. `variant` picks the weight.
export function RequestWorkButton({
  prefill,
  variant = 'primary',
  children = 'Request work',
}: {
  prefill?: { type?: string; site_id?: string; project_id?: string };
  variant?: 'primary' | 'secondary';
  children?: React.ReactNode;
}) {
  const qs = new URLSearchParams();
  if (prefill?.type) qs.set('type', prefill.type);
  if (prefill?.site_id) qs.set('site_id', prefill.site_id);
  if (prefill?.project_id) qs.set('project_id', prefill.project_id);
  const href = qs.size > 0 ? `/portal/requests/new?${qs.toString()}` : '/portal/requests/new';
  const look =
    variant === 'primary'
      ? 'bg-brand-primary text-white hover:bg-brand-primary/90'
      : 'border border-border bg-surface text-text-main hover:bg-surface-secondary';
  return (
    <Link
      href={href}
      className={`inline-flex min-h-[44px] items-center justify-center rounded-md px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${look}`}
    >
      {children}
    </Link>
  );
}
