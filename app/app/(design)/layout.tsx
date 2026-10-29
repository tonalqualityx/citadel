import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAccessToken } from '@/lib/auth/jwt';
import { DesignChrome } from '@/components/domain/design/DesignChrome';
import { DesignStaffShell } from '@/components/domain/design/DesignStaffShell';

// Designer Portal shell (design D1). Admin and pm get the normal Citadel shell (Mike, 2026-10-29: Design is a
// part of the Citadel, not a separate app): DesignStaffShell is AppProviders + Sidebar + Header + CommandPalette.
// A designer keeps the minimal shell below, deliberately NOT AppProviders: ThemeProvider calls
// /users/me/preferences and TimerProvider calls /time-entries/active, both 403 for a designer.
// Light/dark comes from the globals.css prefers-color-scheme rules. The root layout supplies
// QueryProvider and the toaster. Every page below is a client component calling /api routes only.
export default async function DesignLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token');
  if (!token) redirect('/login');

  // UX only; the API allowlist is the enforcement. A token that fails to verify (expired) renders
  // the shell so the client-side refresh runs, like the staff layout.
  let role: string | null = null;
  try {
    role = (await verifyAccessToken(token.value)).role;
  } catch {
    role = null;
  }
  if (role !== null && role !== 'designer' && role !== 'admin' && role !== 'pm') {
    redirect('/dashboard');
  }

  if (role === 'admin' || role === 'pm') return <DesignStaffShell>{children}</DesignStaffShell>;

  // Pages size themselves (the workspace is wide, the list and admin pages are narrow), so main only caps the width.
  return (
    <div className="min-h-screen bg-background-light text-text-main">
      <DesignChrome role={role} />
      <main className="mx-auto max-w-[1800px] p-4 sm:p-6">{children}</main>
    </div>
  );
}
