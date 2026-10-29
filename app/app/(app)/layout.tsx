import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { AppProviders } from '@/components/layout/app-providers';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { verifyAccessToken } from '@/lib/auth/jwt';

// BlockNote / Mantine CSS imports
import '@mantine/core/styles.css';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token');

  if (!token) {
    redirect('/login');
  }

  // Designer Portal (design D1): a designer never sees the staff shell. This is UX only; the API
  // allowlist in requireAuth() is the enforcement. A token that fails to verify (expired, say)
  // keeps today's behavior: render, so the client-side refresh runs.
  let role: string | undefined;
  try {
    role = (await verifyAccessToken(token.value)).role;
  } catch {
    role = undefined;
  }
  if (role === 'designer') {
    redirect('/design');
  }

  return (
    <AppProviders>
      <div className="min-h-screen bg-background-light">
        <Sidebar />
        <div className="lg:pl-60">
          <Header />
          <main className="p-6">{children}</main>
        </div>
        <CommandPalette />
      </div>
    </AppProviders>
  );
}
