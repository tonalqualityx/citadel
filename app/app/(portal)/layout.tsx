import '@/app/globals.css';
import './portal-tokens.css';
import './portal-kit.css';
import { Atkinson_Hyperlegible, Lato } from 'next/font/google';
import { PortalShell } from '@/components/portal/shell/portal-shell';

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

// Applies a saved Light or Dark choice before first paint, so a dark reader never sees a white flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem('portal-theme');if(t==='light'||t==='dark'){document.currentScript.parentElement.setAttribute('data-theme',t)}}catch(e){}`;

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div data-portal className={`${lato.variable} ${atkinson.variable} min-h-screen`} suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <PortalShell>{children}</PortalShell>
    </div>
  );
}
