import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { QueryProvider } from '@/lib/providers/query-provider';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Indelible Citadel',
  description: 'Project management for web agencies',
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
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
