import type { MetadataRoute } from 'next';
import { APP_BACKGROUND_COLOR, APP_THEME_COLOR } from '@/lib/pwa/colors';

/**
 * Home Screen app (PWA install). Served at /manifest.webmanifest. No service worker, no push, no offline:
 * the manifest only lets a phone save Citadel to the Home Screen and open it full screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Indelible Citadel',
    short_name: 'Citadel',
    description: 'Project management for web agencies',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: APP_BACKGROUND_COLOR,
    theme_color: APP_THEME_COLOR,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
