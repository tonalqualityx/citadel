import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The direction hook module is mocked (not its fetch calls), keeping the real error class and query key.
const patchDirection = vi.fn();
const useDirection = vi.fn();
vi.mock('@/lib/hooks/use-design-direction', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/use-design-direction')>();
  return { ...actual, patchDirection: (...a: unknown[]) => patchDirection(...a), useDirection: (...a: unknown[]) => useDirection(...a) };
});

import { DirectionError } from '@/lib/hooks/use-design-direction';
import { WidthControl } from '../WidthControl';

function direction(over: Record<string, unknown> = {}, body: Record<string, unknown> = {}) {
  return { data: { direction: { id: 'd1', version: 3, status: 'draft', body, ...over }, signed: null, missing_client_requests: [], sign_gaps: [] } };
}

function renderControl(props: Partial<React.ComponentProps<typeof WidthControl>> = {}, epoch = 0) {
  const send = vi.fn(() => true);
  const qc = new QueryClient();
  const ui = (e: number) => (
    <QueryClientProvider client={qc}>
      <WidthControl sendToken={send} frameEpoch={e} sessionId="s1" {...props} />
    </QueryClientProvider>
  );
  const r = render(ui(epoch));
  fireEvent.click(screen.getByRole('button', { name: 'Width' }));
  return { send, rerenderAt: (e: number) => r.rerender(ui(e)) };
}

beforeEach(() => {
  patchDirection.mockReset();
  useDirection.mockReset();
  useDirection.mockReturnValue(direction());
});

describe('WidthControl', () => {
  it('picking a cap posts --maxw at once, and nothing for what is not set', () => {
    const { send } = renderControl();
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '1440' }));
    expect(send.mock.calls).toEqual([['--maxw', '1440px']]);
    expect(screen.getByRole('button', { name: '1440' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('a gutter set posts the three gutter tokens, a method posts container-method', () => {
    const { send } = renderControl();
    fireEvent.click(screen.getByLabelText(/Roomy 24\/48\/72/));
    expect(send.mock.calls).toEqual([['--gutter-phone', '24px'], ['--gutter-tablet', '48px'], ['--gutter-desktop', '72px']]);
    send.mockClear();
    fireEvent.click(screen.getByLabelText(/Padding cap/));
    expect(send.mock.calls).toEqual([['container-method', 'padding_cap']]);
  });

  it('a typed number in range posts; out of range posts nothing and shows a plain message', () => {
    const { send } = renderControl();
    const field = screen.getByLabelText('Or type a width');
    fireEvent.change(field, { target: { value: '1333' } });
    expect(send.mock.calls).toEqual([['--maxw', '1333px']]);
    send.mockClear();
    for (const bad of ['99999', '319', '2401', '1200.5', '-5']) {
      fireEvent.change(field, { target: { value: bad } });
      expect(screen.getByRole('alert').textContent).toMatch(/whole number from 320 to 2400/);
    }
    expect(send).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Save to direction' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('save PATCHes only the container fields she picked, against the draft version', async () => {
    patchDirection.mockResolvedValue({ direction: { id: 'd1', version: 4, status: 'draft', body: {} } });
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: '1280' }));
    fireEvent.click(screen.getByLabelText(/Standard 16\/32\/48/));
    fireEvent.click(screen.getByLabelText(/Centred cap/));
    fireEvent.click(screen.getByRole('button', { name: 'Save to direction' }));
    await waitFor(() => expect(patchDirection).toHaveBeenCalledTimes(1));
    expect(patchDirection).toHaveBeenCalledWith('s1', { container: { max_content_px: 1280, method: 'max_width', gutters_px: { phone: 16, tablet: 32, desktop: 48 } } }, 3);
    await waitFor(() => expect(screen.getByTestId('width-status').textContent).toBe('Saved to the direction.'));
  });

  it('starts from the saved container values and shows them', () => {
    useDirection.mockReturnValue(direction({}, { container: { max_content_px: 1200, method: 'padding_cap', gutters_px: { phone: 20, tablet: 30, desktop: 40 } } }));
    const { send } = renderControl();
    expect(screen.getByRole('button', { name: '1200' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText(/Padding cap/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText(/Saved 20\/30\/40/)).toBeTruthy();
    expect(send).toHaveBeenCalledWith('--maxw', '1200px');
  });

  it('signed: saving is off with a reason, preview still works', () => {
    useDirection.mockReturnValue(direction({ status: 'signed' }));
    const { send } = renderControl();
    expect((screen.getByRole('button', { name: 'Save to direction' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('width-status').textContent).toMatch(/signed off/);
    fireEvent.click(screen.getByRole('button', { name: '1140' }));
    expect(send).toHaveBeenCalledWith('--maxw', '1140px');
    expect(patchDirection).not.toHaveBeenCalled();
  });

  it('no session: saving is off with a reason and the direction is never read', () => {
    renderControl({ sessionId: null });
    expect(useDirection).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Save to direction' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('width-status').textContent).toMatch(/previewing only/);
  });

  it('re-posts the current picks after the frame loads a page', () => {
    const { send, rerenderAt } = renderControl();
    fireEvent.click(screen.getByRole('button', { name: '1440' }));
    fireEvent.click(screen.getByLabelText(/Padding cap/));
    send.mockClear();
    rerenderAt(1);
    expect(send.mock.calls).toEqual([['--maxw', '1440px'], ['container-method', 'padding_cap']]);
  });

  it('reset removes every override and restores the built page', () => {
    const { send } = renderControl();
    fireEvent.click(screen.getByRole('button', { name: '1440' }));
    fireEvent.click(screen.getByLabelText(/Padding cap/));
    send.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(send.mock.calls).toEqual([['--maxw', null], ['container-method', null]]);
    expect(screen.getByTestId('width-summary').textContent).toBe('Showing the built page');
  });

  it('a moved version shows a plain message and does not claim it saved', async () => {
    patchDirection.mockRejectedValue(new DirectionError('moved', 409, 'version_moved'));
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: '1280' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save to direction' }));
    await waitFor(() => expect(screen.getByTestId('width-status').textContent).toMatch(/just updated/));
  });
});
