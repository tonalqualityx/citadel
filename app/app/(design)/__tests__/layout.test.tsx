import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const redirect = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); });
let cookieValue: string | undefined = 'tok';
let verify: () => Promise<{ role: string }> = async () => ({ role: 'designer' });

vi.mock('next/navigation', () => ({ redirect: (u: string) => redirect(u) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (cookieValue ? { value: cookieValue } : undefined) }) }));
vi.mock('@/lib/auth/jwt', () => ({ verifyAccessToken: () => verify() }));
vi.mock('@/components/domain/design/DesignChrome', () => ({ DesignChrome: ({ role }: { role: string | null }) => `chrome:${role}` }));

vi.mock('@/components/domain/design/DesignStaffShell', () => ({ DesignStaffShell: ({ children }: { children: unknown }) => children }));

import DesignLayout from '../layout';
import { DesignChrome } from '@/components/domain/design/DesignChrome';
import { DesignStaffShell } from '@/components/domain/design/DesignStaffShell';

/** Every component type in a rendered element tree (the layouts return plain element trees, nothing is mounted). */
function types(node: unknown, out: unknown[] = []): unknown[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => types(n, out)); return out; }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type) out.push(el.type);
  types(el.props?.children, out);
  return out;
}

beforeEach(() => { redirect.mockClear(); cookieValue = 'tok'; verify = async () => ({ role: 'designer' }); });

describe('(design) layout', () => {
  it('imports no staff provider or chrome that hits designer-forbidden routes', () => {
    const files = ['layout.tsx', '../../components/domain/design/DesignChrome.tsx', 'design/page.tsx'];
    for (const f of files) {
      const src = readFileSync(path.join(__dirname, '..', f), 'utf8')
        .split('\n').filter((l) => /^\s*(import|.*require\()/.test(l) || /<[A-Z]\w+/.test(l) || /use[A-Z]\w+\(/.test(l)).join('\n');
      for (const banned of ['ThemeProvider', 'TimerProvider', 'AppProviders', 'NotificationBell', 'layout/Header', 'use-preferences', 'useTerminology', 'use-timer']) {
        expect(src, `${f} must not reference ${banned}`).not.toContain(banned);
      }
    }
  });

  it.each(['designer', 'admin', 'pm'])('renders for %s', async (role) => {
    verify = async () => ({ role });
    await expect(DesignLayout({ children: null })).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each(['admin', 'pm'])('renders the Citadel staff shell for %s, not the minimal chrome', async (role) => {
    verify = async () => ({ role });
    const tree = types(await DesignLayout({ children: null }));
    expect(tree).toContain(DesignStaffShell);
    expect(tree).not.toContain(DesignChrome);
  });

  it('renders the minimal shell for a designer and never the staff shell', async () => {
    const tree = types(await DesignLayout({ children: null }));
    expect(tree).toContain(DesignChrome);
    expect(tree).not.toContain(DesignStaffShell);
  });

  it('the staff shell is the same chrome as the (app) layout', () => {
    const shell = readFileSync(path.join(__dirname, '../../../components/domain/design/DesignStaffShell.tsx'), 'utf8');
    for (const part of ['AppProviders', 'Sidebar', 'Header', 'CommandPalette']) expect(shell).toContain(part);
  });

  it('redirects tech to /dashboard', async () => {
    verify = async () => ({ role: 'tech' });
    await expect(DesignLayout({ children: null })).rejects.toThrow('REDIRECT:/dashboard');
  });

  it('redirects to /login without a cookie', async () => {
    cookieValue = undefined;
    await expect(DesignLayout({ children: null })).rejects.toThrow('REDIRECT:/login');
  });

  it('renders the shell when verification fails', async () => {
    verify = async () => { throw new Error('expired'); };
    await expect(DesignLayout({ children: null })).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
