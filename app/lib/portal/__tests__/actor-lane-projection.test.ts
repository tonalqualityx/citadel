import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Fleet item 6: actor_lane is staff-only. The portal projections never select it and never show a
// lane name; staff replies stay signed "Indelible team" / "Indelible Support".
vi.mock('@/lib/db/prisma', () => ({
  prisma: { task: { findFirst: vi.fn() }, comment: { findMany: vi.fn() } },
}));

import { prisma } from '@/lib/db/prisma';
import { loadThread, toThreadMessage } from '../thread';

const APP = path.resolve(__dirname, '../../..');
const access = { clientId: 'client-1', contactId: 'contact-1', contactIds: ['contact-1'] } as never;

beforeEach(() => vi.clearAllMocks());

describe('portal projection omits actor_lane', () => {
  it('toThreadMessage drops actor_lane and never names the lane', () => {
    const row = {
      id: 'c1', content: 'We fixed the hours.', created_at: new Date('2026-10-25T10:00:00Z'),
      author_contact_id: null, author_contact: null, user_id: 'bast', actor_lane: 'porter',
      is_internal: false, client_visible: true,
    };
    const msg = toThreadMessage(row as never, ['contact-1']);
    expect(Object.keys(msg).sort()).toEqual(['author', 'created_at', 'id', 'mine', 'text']);
    expect(msg.author).toEqual({ kind: 'staff', name: expect.stringMatching(/^Indelible/) });
    expect(JSON.stringify(msg)).not.toMatch(/porter|actor_lane|Bast/);
  });

  it('loadThread selects no actor_lane column', async () => {
    (prisma.task.findFirst as Mock).mockResolvedValue({ id: 't1' });
    (prisma.comment.findMany as Mock).mockResolvedValue([
      { id: 'c1', content: 'x', created_at: new Date(), author_contact_id: null, author_contact: null, actor_lane: 'courier' },
    ]);
    const out = await loadThread(access, 't1');
    const select = (prisma.comment.findMany as Mock).mock.calls[0][0].select;
    expect(select).not.toHaveProperty('actor_lane');
    expect(JSON.stringify(out)).not.toMatch(/courier|actor_lane/);
  });

  it('no portal code reads actor_lane (portal libs, portal API routes, portal pages and components)', () => {
    const roots = ['lib/portal', 'app/api/portal', 'app/(portal)', 'components/portal'].map((r) => path.join(APP, r));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p);
        } else if (/\.(ts|tsx)$/.test(e.name)) {
          const src = fs.readFileSync(p, 'utf8');
          // The only allowed mention is the server-side stamp on writes.
          const reads = src.split('\n').filter((l) => /actor_lane/.test(l) && !/actorLaneField/.test(l));
          if (reads.length) offenders.push(path.relative(APP, p));
        }
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});
