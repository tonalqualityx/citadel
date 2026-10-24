import { describe, it, expect, vi } from 'vitest';
import { openPriceReviews } from '../open';

const row = (id: string, reviewOn: string) => ({
  id,
  client_id: `c-${id}`,
  site_id: null,
  client_label: `Plan ${id}`,
  start_date: new Date('2025-01-01T00:00:00.000Z'),
  price_review_on: new Date(`${reviewOn}T00:00:00.000Z`),
  client: { name: `Client ${id}`, parent_agency_id: null },
});

describe('the opener keeps going when one charter fails', () => {
  it('reports the failing charter and still handles the next one', async () => {
    const db = {
      charter: { findMany: vi.fn(async () => [row('bad', '2027-03-01'), row('good', '2027-03-02')]) },
      wait: {
        findUnique: vi.fn(async ({ where }: { where: { idempotency_key: string } }) => {
          if (where.idempotency_key.includes(':bad:')) throw new Error('db hiccup');
          return null;
        }),
        findMany: vi.fn(async () => []),
      },
    };
    // Far from the window, so the good charter lands in not_yet and nothing is written.
    const r = await openPriceReviews(db as never, { now: new Date('2026-10-24T15:00:00Z') });
    expect(r.errors).toEqual([{ charter_id: 'bad', error: 'db hiccup' }]);
    expect(r.not_yet.map((x) => x.charter_id)).toEqual(['good']);
  });
});
