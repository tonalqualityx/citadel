import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as React from 'react';

let pathname = '/design/s/11111111-1111-4111-8111-111111111111';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('../DesignChrome', () => ({ DesignChrome: ({ role }: { role: string | null }) => <header data-testid="chrome">chrome:{role}</header> }));

import { DesignerShell } from '../DesignerShell';
import { TOP_KEY, useTopHidden, resetTopHiddenForTests } from '../workspace-chrome';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() };
}
let store = memoryStorage();

beforeEach(() => {
  store = memoryStorage();
  vi.stubGlobal('localStorage', store);
  pathname = '/design/s/11111111-1111-4111-8111-111111111111';
  resetTopHiddenForTests();
});

describe('DesignerShell', () => {
  it('keeps exactly the old markup off the workspace route', () => {
    pathname = '/design';
    const { container } = render(<DesignerShell role="designer">x</DesignerShell>);
    expect(container.firstElementChild!.className).toBe('min-h-screen bg-background-light text-text-main');
    expect(container.querySelector('main')!.className).toBe('mx-auto max-w-[1800px] p-4 sm:p-6');
    expect(screen.getByTestId('chrome').textContent).toBe('chrome:designer');
  });

  it('on the workspace route is exactly the viewport tall and does not scroll', () => {
    const { container } = render(<DesignerShell role="designer">x</DesignerShell>);
    const root = container.firstElementChild!.className;
    for (const c of ['h-dvh', 'overflow-hidden', 'flex', 'flex-col']) expect(root).toContain(c);
    const main = container.querySelector('main')!.className;
    for (const c of ['mx-auto', 'max-w-[1800px]', 'flex', 'min-h-0', 'w-full', 'flex-1', 'flex-col', 'p-2', 'sm:p-3']) expect(main).toContain(c);
    expect(screen.getByTestId('designer-header-wrap').hidden).toBe(false);
  });

  it('hides the chrome (still mounted) when the top is hidden, on the workspace route only', () => {
    store.setItem(TOP_KEY, 'hidden');
    const { unmount } = render(<DesignerShell role="designer">x</DesignerShell>);
    expect(screen.getByTestId('designer-header-wrap').hidden).toBe(true);
    expect(screen.getByTestId('chrome')).toBeTruthy();
    unmount();
    pathname = '/design/admin';
    render(<DesignerShell role="designer">x</DesignerShell>);
    expect(screen.getByTestId('designer-header-wrap').hidden).toBe(false);
  });

  it('follows the shared choice when the workspace toggles it', () => {
    function Toggler() {
      const [h, set] = useTopHidden();
      return <button onClick={() => set(!h)}>flip</button>;
    }
    render(<DesignerShell role="designer"><Toggler /></DesignerShell>);
    expect(screen.getByTestId('designer-header-wrap').hidden).toBe(false);
    act(() => { fireEvent.click(screen.getByText('flip')); });
    expect(screen.getByTestId('designer-header-wrap').hidden).toBe(true);
  });
});
