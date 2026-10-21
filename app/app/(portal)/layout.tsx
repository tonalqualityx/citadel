import '@/app/globals.css';
import './portal-tokens.css';
import './portal-kit.css';
import { Atkinson_Hyperlegible, Lato } from 'next/font/google';
import { ClientSwitcher } from '@/components/portal/client-switcher';
import { PortalNav } from '@/components/portal/portal-nav';

export const metadata = {
  title: 'Indelible Portal',
  description: 'View and respond to proposals',
};

// Lato for headlines and the wordmark, Atkinson Hyperlegible for everything people read.
const lato = Lato({ weight: ['400', '700', '900'], subsets: ['latin'], variable: '--font-lato', display: 'swap' });
const atkinson = Atkinson_Hyperlegible({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-atkinson',
  display: 'swap',
});

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div data-portal className={`${lato.variable} ${atkinson.variable} min-h-screen`} suppressHydrationWarning>
      <header className="border-b border-p-line bg-p-surface px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold">Indelible</h1>
          <ClientSwitcher />
        </div>
      </header>
      <PortalNav />
      <main className="max-w-4xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  );
}
