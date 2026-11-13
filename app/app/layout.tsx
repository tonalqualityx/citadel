import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { QueryProvider } from '@/lib/providers/query-provider';
import { ChunkRecovery } from '@/components/layout/chunk-recovery';
import { APP_THEME_COLOR, APP_THEME_COLOR_DARK } from '@/lib/pwa/colors';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Indelible Citadel',
  description: 'Project management for web agencies',
  applicationName: 'Citadel',
  // iPhone Home Screen app: opens full screen; the status bar sits over the page (the header clears it with safe-area padding).
  appleWebApp: { capable: true, title: 'Citadel', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: APP_THEME_COLOR },
    { media: '(prefers-color-scheme: dark)', color: APP_THEME_COLOR_DARK },
  ],
};

// Script to apply theme immediately before React hydrates (prevents flash)
const themeScript = `
  (function() {
    try {
      var theme = localStorage.getItem('indelible-theme');
      if (theme === 'light') document.documentElement.classList.add('theme-light');
      else if (theme === 'dim') document.documentElement.classList.add('theme-dim');
      else if (theme === 'dark') document.documentElement.classList.add('theme-dark');
    } catch (e) {}
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ChunkRecovery />
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
