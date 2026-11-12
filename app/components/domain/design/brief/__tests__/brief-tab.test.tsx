import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

import { BriefTab } from '../BriefTab';
import type { BriefResponse } from '@/lib/hooks/use-design-brief';

const track = { id: 'trk', stage: 'research', busy: false, busy_line: null, preview_alias: 'a', preview_url: null, finish: null };
const IMG = '11111111-1111-4111-8111-111111111111';
const NOTE_A = '22222222-2222-4222-8222-222222222222';
const NOTE_B = '33333333-3333-4333-8333-333333333333';

const card = (id: string, over: Record<string, unknown> = {}) => ({
  id, headline: `Headline ${id}`, summary: `Summary ${id}`, image_asset_ids: [], detail_md: '', sources: [], confidence: 'evidenced', ...over,
});
const stmt = (id: string, over: Record<string, unknown> = {}) => ({
  id, quote: 'We want it to feel solid', speaker_name: 'Brian', speaker_role: 'Owner', source_date: '2026-10-02T00:00:00.000Z',
  source_kind: 'call', is_paraphrase: false, subject: 'Feel', category: 'tone', polarity: 'want', status: 'active', ...over,
});

function brief(over: Partial<BriefResponse> = {}): BriefResponse {
  return {
    brief: {
      id: 'b1', version: 1, published_at: '2026-11-01T00:00:00.000Z',
      body: {
        version: 1, client_name: 'Stronghold', one_line: 'A site for people who build.',
        // deliberately out of the fixed order
        sections: [
          { id: 'constraints', title: 'Constraints', cards: [card('con-1')] },
          { id: 'client_said', title: 'What the client said', cards: [card('said-1', { sources: [{ kind: 'design_note', id: NOTE_A }, { kind: 'design_note', id: NOTE_B }] })] },
          { id: 'brand', title: 'Brand', cards: [card('brand-1', {
            image_asset_ids: [IMG], detail_md: '### Colours\n\nUse **warm** greys. See [guide](https://example.com/g).',
            sources: [
              { kind: 'url', url: 'https://example.com/ref', accessed: '2026-11-02' },
              { kind: 'file', path: 'CL/x/profile.md' },
              { kind: 'drive', file_id: 'abc', title: 'Brand guide v2' },
              { kind: 'design_note', id: NOTE_A },
            ],
          })] },
        ],
      },
    },
    assets: [{ id: IMG, kind: 'brand', content_type: 'image/png', width: 10, height: 10, url: `/api/design/sessions/s1/track-assets/${IMG}` }],
    reactions: [],
    client_statements: [stmt(NOTE_A), stmt(NOTE_B, { quote: 'Brian said the budget is tight', is_paraphrase: true, speaker_name: 'Mike', speaker_role: 'Indelible' })],
    ...over,
  } as BriefResponse;
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const mount = () => wrap(<BriefTab sessionId="s1" track={track} feed={undefined} />);

beforeEach(() => {
  get.mockReset().mockResolvedValue(brief());
  post.mockReset().mockImplementation((_u: string, b: { card_id: string; reaction: string; note?: string }) => Promise.resolve({ reaction: { card_id: b.card_id, reaction: b.reaction, note: b.note ?? null } }));
});

describe('Brief tab', () => {
  it('reads the session brief route', async () => {
    mount();
    await screen.findByText('Headline brand-1');
    expect(get).toHaveBeenCalledWith('/design/sessions/s1/brief');
  });

  it('shows sections in the fixed order whatever order they arrive in', async () => {
    mount();
    await screen.findByText('Headline brand-1');
    const ids = screen.getAllByTestId('brief-section').map((s) => s.getAttribute('data-section'));
    expect(ids).toEqual(['brand', 'client_said', 'constraints']);
    expect(screen.getByTestId('brief-one-line').textContent).toBe('A site for people who build.');
  });

  it('shows a confidence label in words', async () => {
    mount();
    await screen.findByText('Headline brand-1');
    expect(screen.getAllByTestId('confidence').map((e) => e.textContent)).toContain('Backed by evidence');
  });

  it('the empty state is one plain sentence with no internal words', async () => {
    get.mockResolvedValue({ brief: null, assets: [], reactions: [], client_statements: [] });
    mount();
    const el = await screen.findByTestId('brief-empty');
    expect(el.textContent).toMatch(/still being prepared/);
    expect(el.textContent).not.toMatch(/track|job|worker|gate|lane|runner|asset/i);
  });

  it('the client said section quotes the client; a paraphrase carries the label', async () => {
    mount();
    await screen.findByText('Headline said-1');
    const sec = screen.getAllByTestId('brief-section').find((s) => s.getAttribute('data-section') === 'client_said')!;
    const quotes = within(sec).getAllByTestId('client-quote');
    expect(quotes).toHaveLength(2);
    expect(quotes[0].textContent).toContain('“We want it to feel solid”');
    expect(quotes[0].textContent).toContain('Brian, Owner, Oct 2, 2026');
    expect(within(quotes[0]).queryByTestId('paraphrase-label')).toBeNull();
    expect(within(quotes[1]).getByTestId('paraphrase-label').textContent).toBe("Mike's notes of the call");
  });

  it('an image points at the session-scoped track-assets route and nowhere else', async () => {
    get.mockResolvedValue(brief({ assets: [{ id: IMG, kind: 'brand', content_type: 'image/png', width: 1, height: 1, url: 'https://evil.example/x.png' }] }));
    mount();
    await screen.findByText('Headline brand-1');
    const imgs = [...document.querySelectorAll('img')];
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe(`/api/design/sessions/s1/track-assets/${IMG}`);
    expect(imgs[0].getAttribute('alt')).toMatch(/Headline brand-1/);
  });

  it('an image id the server did not return as servable shows no image', async () => {
    get.mockResolvedValue(brief({ assets: [] }));
    mount();
    await screen.findByText('Headline brand-1');
    expect(document.querySelector('img')).toBeNull();
  });

  it('HTML inside a card is shown as text', async () => {
    const b = brief();
    b.brief!.body.sections[2].cards[0].headline = '<img src=x onerror=alert(1)>';
    b.brief!.body.sections[2].cards[0].summary = '<script>alert(1)</script> hello';
    b.brief!.body.sections[2].cards[0].detail_md = '<iframe src="https://evil.example"></iframe>';
    get.mockResolvedValue(b);
    mount();
    await screen.findByText('<img src=x onerror=alert(1)>');
    fireEvent.click(screen.getByRole('button', { name: /Open details and sources: <img/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('<iframe src="https://evil.example"></iframe>');
    expect(document.querySelector('script, iframe, [onerror]')).toBeNull();
    expect(screen.getAllByText(/<script>alert\(1\)<\/script> hello/, { selector: "p" }).length).toBeGreaterThan(0);
  });
});

describe('Brief drawer', () => {
  const openBrand = async () => {
    mount();
    const btn = await screen.findByRole('button', { name: 'Open details and sources: Headline brand-1' });
    btn.focus();
    fireEvent.click(btn);
    return btn;
  };

  it('opens with dialog semantics, detail rendered through the markdown renderer, and the sources', async () => {
    await openBrand();
    const dialog = await screen.findByRole('dialog', { name: 'Headline brand-1' });
    expect(dialog.getAttribute('aria-modal') === 'true' || dialog.getAttribute('role') === 'dialog').toBe(true);
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Colours' })).toBeTruthy();
    expect(within(dialog).getByText('warm').tagName).toBe('STRONG');
    const link = within(dialog).getByRole('link', { name: 'guide' });
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    const sources = within(dialog).getByRole('list', { name: 'Sources' });
    expect(sources.textContent).toContain('https://example.com/ref');
    expect(sources.textContent).toContain('looked at Nov 2, 2026');
    expect(sources.textContent).toContain('CL/x/profile.md');
    expect(sources.textContent).toContain('Brand guide v2');
    expect(sources.textContent).toContain('We want it to feel solid');
    expect(sources.textContent).toContain('Brian, Owner, Oct 2, 2026');
  });

  it('Escape closes it and focus returns to the card button', async () => {
    const btn = await openBrand();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(btn));
  });

  it('the close button closes it and returns focus', async () => {
    const btn = await openBrand();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(btn));
  });
});

describe('reactions', () => {
  const group = (headline: string) => screen.getByRole('group', { name: `Your view of: ${headline}` });

  it('Useful posts the card and reaction, and flips aria-pressed', async () => {
    mount();
    await screen.findByText('Headline brand-1');
    const useful = within(group('Headline brand-1')).getByRole('button', { name: 'Useful' });
    expect(useful.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(useful);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/design/sessions/s1/brief/reactions', { card_id: 'brand-1', reaction: 'useful' }));
    await waitFor(() => expect(within(group('Headline brand-1')).getByRole('button', { name: /Useful/ }).getAttribute('aria-pressed')).toBe('true'));
    expect(within(group('Headline brand-1')).getByRole('button', { name: /Not relevant/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('a note is saved with the current reaction', async () => {
    get.mockResolvedValue(brief({ reactions: [{ card_id: 'brand-1', reaction: 'not_relevant', note: null }] }));
    mount();
    await screen.findByText('Headline brand-1');
    const g = within(group('Headline brand-1'));
    expect(g.getByRole('button', { name: /Not relevant/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(g.getByLabelText('Note on: Headline brand-1'), { target: { value: '  Too corporate  ' } });
    fireEvent.click(g.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/design/sessions/s1/brief/reactions', { card_id: 'brand-1', reaction: 'not_relevant', note: 'Too corporate' }));
  });

  it('the note box is off until a reaction is chosen', async () => {
    mount();
    await screen.findByText('Headline brand-1');
    expect((within(group('Headline brand-1')).getByLabelText('Note on: Headline brand-1') as HTMLInputElement).disabled).toBe(true);
  });

  it('rolls back on a 500 and shows a plain error line', async () => {
    post.mockReset().mockRejectedValue(new Error('500'));
    mount();
    await screen.findByText('Headline brand-1');
    fireEvent.click(within(group('Headline brand-1')).getByRole('button', { name: 'Useful' }));
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent).join('')).toMatch(/did not save/));
    const useful = within(group('Headline brand-1')).getByRole('button', { name: 'Useful' });
    expect(useful.getAttribute('aria-pressed')).toBe('false');
  });
});
