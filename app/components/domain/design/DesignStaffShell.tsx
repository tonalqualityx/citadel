import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { AppProviders } from '@/components/layout/app-providers';
import { CommandPalette } from '@/components/layout/CommandPalette';

// The normal Citadel chrome, same as app/(app)/layout.tsx, for admin and pm on /design. Kept in its own module so
// the designer path of app/(design)/layout.tsx never reaches AppProviders for a designer session (a designer is
// 403 on the routes its ThemeProvider, TimerProvider, Header and NotificationBell call).
export function DesignStaffShell({ children }: { children: React.ReactNode }) {
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
