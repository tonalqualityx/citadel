import { describe, it, expect, vi, type Mock } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from '../proxy';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock('@/components/layout/AppShell', () => ({ AppShell: () => null }));
vi.mock('@/components/layout/app-providers', () => ({ AppProviders: () => null }));
vi.mock('@mantine/core/styles.css', () => ({}));
vi.mock('@blocknote/core/fonts/inter.css', () => ({}));
vi.mock('@blocknote/mantine/style.css', () => ({}));
import { cookies } from 'next/headers';
import AppLayout from '@/app/(app)/layout';

const root = process.cwd();

// Sign-in is enforced by the (app) layout (and requireAuth on /api). The manifest and icons sit outside
// both, so they load without a session; nothing is added to the proxy or to an allowlist.
describe('home screen app files load without a session', () => {
  it('manifest route lives at the app root, not under the signed-in (app) group', () => {
    expect(existsSync(path.join(root, 'app/manifest.ts'))).toBe(true);
    expect(existsSync(path.join(root, 'app/(app)/manifest.ts'))).toBe(false);
  });
  it.each(['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png'])('%s is a static public file', (p) => {
    expect(existsSync(path.join(root, 'public', p))).toBe(true);
  });
  it('apple touch icon and favicon are root metadata files', () => {
    expect(existsSync(path.join(root, 'app/apple-icon.png'))).toBe(true);
    expect(existsSync(path.join(root, 'app/icon.png'))).toBe(true);
  });
  it('the proxy only matches /api, so none of these paths touch it', () => {
    expect(config.matcher).toEqual(['/api/:path*']);
  });
  it('a normal signed-in page still redirects to sign-in without a session', async () => {
    (cookies as Mock).mockResolvedValue({ get: () => undefined });
    await expect(AppLayout({ children: null })).rejects.toThrow('REDIRECT:/login');
  });
});
