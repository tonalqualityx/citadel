import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { AppProviders } from '@/components/layout/app-providers';
import { CommandPalette } from '@/components/layout/CommandPalette';

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

  return (
    <AppProviders>
      <div className="min-h-screen bg-background-light">
        <Sidebar />
        <div className="lg:pl-[240px]">
          <Header />
          <main className="p-6">{children}</main>
        </div>
        <CommandPalette />
      </div>
    </AppProviders>
  );
}
