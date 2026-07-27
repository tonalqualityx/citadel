import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    client: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { resolveCoverUrl } from '../cover-assignment';
import { COVER_POOL } from '@/lib/utils/deterministic-cover';

const mockFindUnique = prisma.client.findUnique as Mock;

function htmlResponse(html: string, ok = true, contentType = 'text/html') {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(html);
  return {
    ok,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: async () => {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: bytes };
          },
          cancel: async () => undefined,
        };
      },
    },
  };
}

describe('resolveCoverUrl', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns a bundled pool cover when no clientId is given (no network call)', async () => {
    global.fetch = vi.fn();
    const result = await resolveCoverUrl({ itemId: 'task-1' });
    expect(COVER_POOL).toContain(result);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns a bundled pool cover when the client has no site with a url', async () => {
    mockFindUnique.mockResolvedValue({ sites: [{ url: null }] });
    global.fetch = vi.fn();
    const result = await resolveCoverUrl({ itemId: 'task-2', clientId: 'client-1' });
    expect(COVER_POOL).toContain(result);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('resolves the client site\'s og:image when present', async () => {
    mockFindUnique.mockResolvedValue({ sites: [{ url: 'https://example-client.com' }] });
    global.fetch = vi.fn().mockResolvedValue(
      htmlResponse('<html><head><meta property="og:image" content="https://example-client.com/cover.jpg"></head></html>')
    );
    const result = await resolveCoverUrl({ itemId: 'task-3', clientId: 'client-2' });
    expect(result).toBe('https://example-client.com/cover.jpg');
  });

  it('resolves a relative og:image URL against the site url', async () => {
    mockFindUnique.mockResolvedValue({ sites: [{ url: 'https://example-client.com/' }] });
    global.fetch = vi.fn().mockResolvedValue(
      htmlResponse('<html><head><meta property="og:image" content="/assets/cover.jpg"></head></html>')
    );
    const result = await resolveCoverUrl({ itemId: 'task-4', clientId: 'client-3' });
    expect(result).toBe('https://example-client.com/assets/cover.jpg');
  });

  it('falls back to the pool when the site has no og:image tag', async () => {
    mockFindUnique.mockResolvedValue({ sites: [{ url: 'https://example-client.com' }] });
    global.fetch = vi.fn().mockResolvedValue(htmlResponse('<html><head><title>No cover here</title></head></html>'));
    const result = await resolveCoverUrl({ itemId: 'task-5', clientId: 'client-4' });
    expect(COVER_POOL).toContain(result);
  });

  it('falls back to the pool when the site fetch fails outright', async () => {
    mockFindUnique.mockResolvedValue({ sites: [{ url: 'https://example-client.com' }] });
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    const result = await resolveCoverUrl({ itemId: 'task-6', clientId: 'client-5' });
    expect(COVER_POOL).toContain(result);
  });

  it('falls back to the pool when the response is non-OK', async () => {
    mockFindUnique.mockResolvedValue({ sites: [{ url: 'https://example-client.com' }] });
    global.fetch = vi.fn().mockResolvedValue(htmlResponse('<html></html>', false));
    const result = await resolveCoverUrl({ itemId: 'task-7', clientId: 'client-6' });
    expect(COVER_POOL).toContain(result);
  });

  it('falls back to the pool when the client lookup itself throws', async () => {
    mockFindUnique.mockRejectedValue(new Error('db down'));
    global.fetch = vi.fn();
    const result = await resolveCoverUrl({ itemId: 'task-8', clientId: 'client-7' });
    expect(COVER_POOL).toContain(result);
  });

  it('never throws — always resolves to a usable string', async () => {
    mockFindUnique.mockResolvedValue({ sites: [{ url: 'not a valid url' }] });
    global.fetch = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(resolveCoverUrl({ itemId: 'task-9', clientId: 'client-8' })).resolves.toEqual(expect.any(String));
  });
});
