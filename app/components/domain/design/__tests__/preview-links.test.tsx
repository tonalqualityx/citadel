import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

const post = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiClient: { post: (...a: unknown[]) => post(...a) } }));

import { PreviewLinks } from '../PreviewLinks';

const ALIAS = 'https://design-t-abcd2345abcd2345.vcdp.pages.dev';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const openPanel = () => fireEvent.click(screen.getByRole('button', { name: 'Preview links' }));
const writeText = vi.fn();

beforeEach(() => {
  post.mockReset().mockResolvedValue({ sent: true });
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

describe('PreviewLinks', () => {
  it('is disabled with a plain reason when there is no preview yet', () => {
    wrap(<PreviewLinks sessionId="s1" previewUrl={null} path="/about/" />);
    const btn = screen.getByRole('button', { name: 'Preview links' });
    expect(btn).toBeDisabled();
    expect(screen.getByText('The preview is not ready yet.')).toBeInTheDocument();
  });

  it('opens a panel with a page link and a site link that open in a new tab', () => {
    wrap(<PreviewLinks sessionId="s1" previewUrl={ALIAS} path="/about/?x=1" />);
    openPanel();
    const page = screen.getByRole('link', { name: /Open this page/ });
    const site = screen.getByRole('link', { name: /Open the site/ });
    expect(page).toHaveAttribute('href', `${ALIAS}/about/`);
    expect(site).toHaveAttribute('href', `${ALIAS}/`);
    for (const a of [page, site]) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('shows the site link only when the path is refused', () => {
    wrap(<PreviewLinks sessionId="s1" previewUrl={ALIAS} path="//evil.example/x" />);
    openPanel();
    expect(screen.queryByRole('link', { name: /Open this page/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Open the site/ })).toHaveAttribute('href', `${ALIAS}/`);
    expect(screen.getByRole('button', { name: 'Email me the site link' })).toBeInTheDocument();
  });

  it('shows no links when the preview address is not a pages.dev address', () => {
    wrap(<PreviewLinks sessionId="s1" previewUrl="https://evil.example" path="/" />);
    expect(screen.getByRole('button', { name: 'Preview links' })).toBeDisabled();
  });

  it('copies each link and announces it', async () => {
    wrap(<PreviewLinks sessionId="s1" previewUrl={ALIAS} path="/about/" />);
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: /Copy link to this page/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${ALIAS}/about/`));
    expect(await screen.findByRole('button', { name: /Copied/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Copied the link to this page.');
    fireEvent.click(screen.getByRole('button', { name: /Copy link to the site/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${ALIAS}/`));
  });

  it('says so in words when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    wrap(<PreviewLinks sessionId="s1" previewUrl={ALIAS} path="/about/" />);
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: /Copy link to this page/ }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copying is not available here'));
  });

  it('emails the current page and confirms', async () => {
    wrap(<PreviewLinks sessionId="s1" previewUrl={ALIAS} path="/about/" />);
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Email me this link' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/design/sessions/s1/preview-link', { path: '/about/' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sent to your email'));
  });

  it('explains the rate limit in plain words', async () => {
    post.mockRejectedValue(new Error('Too many requests. Please try again later.'));
    wrap(<PreviewLinks sessionId="s1" previewUrl={ALIAS} path="/about/" />);
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Email me this link' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('limit of 10 emailed links an hour'));
  });

  it('shows a general failure in plain words', async () => {
    post.mockRejectedValue(new Error('boom'));
    wrap(<PreviewLinks sessionId="s1" previewUrl={ALIAS} path="/about/" />);
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Email me this link' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('could not be sent'));
  });

  it('closes on Escape and returns focus to the button', () => {
    wrap(<PreviewLinks sessionId="s1" previewUrl={ALIAS} path="/" />);
    openPanel();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('link', { name: /Open the site/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview links' })).toHaveFocus();
  });
});
