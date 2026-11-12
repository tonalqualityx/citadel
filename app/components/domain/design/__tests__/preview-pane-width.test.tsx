import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/hooks/use-design-direction', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/use-design-direction')>();
  return { ...actual, useDirection: vi.fn(), patchDirection: vi.fn() };
});

import { PreviewPane } from '../PreviewPane';
import { VIEWPORTS } from '../ViewportSwitcher';

const PREVIEW = 'https://vcdp-abc.pages.dev';
function pane(over: Partial<React.ComponentProps<typeof PreviewPane>> = {}) {
  return render(<PreviewPane previewUrl={PREVIEW} status="active" iframeRef={React.createRef<HTMLIFrameElement>()} selectMode={false} onSelectModeChange={() => undefined} {...over} />);
}
const iframe = () => document.querySelector('iframe') as HTMLIFrameElement;

describe('viewport switcher widths', () => {
  it('offers 390, 768, 1280, 1440, 1680 and Fit', () => {
    expect(VIEWPORTS.map((v) => v.label)).toEqual(['390', '768', '1280', '1440', '1680', 'Fit']);
  });
});

describe('wide viewports scale to fit the pane', () => {
  let cw: PropertyDescriptor | undefined;
  let ch: PropertyDescriptor | undefined;
  beforeEach(() => {
    cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    ch = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  });
  afterEach(() => {
    if (cw) Object.defineProperty(HTMLElement.prototype, 'clientWidth', cw);
    if (ch) Object.defineProperty(HTMLElement.prototype, 'clientHeight', ch);
  });

  it('1440 in a 1200px pane lays out at 1440 and scales to 83%', () => {
    pane();
    fireEvent.click(screen.getByRole('button', { name: '1440' }));
    expect(iframe().style.width).toBe('1440px');
    expect(iframe().style.transform).toContain(`scale(${1200 / 1440})`);
    expect(screen.getByTestId('scale-badge').textContent).toBe('Scaled to 83%');
  });

  it('1680 in a 1200px pane lays out at 1680, scales to 71%, and the wrapper fits the pane', () => {
    pane();
    fireEvent.click(screen.getByRole('button', { name: '1680' }));
    const f = iframe();
    expect(f.style.width).toBe('1680px');
    expect(f.style.transform).toContain(`scale(${1200 / 1680})`);
    expect(f.style.height).toBe(`${Math.ceil(600 / (1200 / 1680))}px`);
    expect(screen.getByTestId('preview-frame-wrapper').style.width).toBe('1200px');
    expect(screen.getByTestId('scale-badge').textContent).toBe('Scaled to 71%');
  });
});

describe('Width control in the pane', () => {
  it('is absent without a token sender, present with one (preview only without a session)', () => {
    const { unmount } = pane();
    expect(screen.queryByTestId('width-control')).toBeNull();
    unmount();
    const send = vi.fn(() => true);
    pane({ sendPreviewToken: send, frameEpoch: 0, directionSessionId: null });
    fireEvent.click(screen.getByRole('button', { name: 'Width' }));
    fireEvent.click(screen.getByRole('button', { name: '1200' }));
    expect(send).toHaveBeenCalledWith('--maxw', '1200px');
  });
});
