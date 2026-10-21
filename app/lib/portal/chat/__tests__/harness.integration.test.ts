import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('next/headers', async () => {
  const { auth } = await import('./harness/auth-state');
  return { headers: async () => new Headers(auth.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}), cookies: async () => ({ get: () => undefined }) };
});
vi.mock('@/lib/services/client-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/services/client-auth')>();
  const { auth } = await import('./harness/auth-state');
  return { ...real, requireClientAuth: async () => auth.session };
});

import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { cleanupWorld, mintEngineKey, playScenario, type Scenario } from './harness/run';

const dir = path.join(__dirname, 'harness', 'scenarios');
const scenarios: Scenario[] = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));

// Phase C slice C2: the recorded-response harness (spec 11.6). Real routes, real scratch database,
// recorded engine results, no model.
describe.skipIf(!SCRATCH)('scripted conversations (recorded responses)', () => {
  let key = { raw: '', id: '' };
  beforeAll(async () => {
    key = await mintEngineKey();
  });
  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { id: key.id } });
    await prisma.$disconnect();
  });

  it('has at least sixteen scenarios', () => expect(scenarios.length).toBeGreaterThanOrEqual(16));

  for (const sc of scenarios) {
    it(sc.name, async () => {
      let played: Awaited<ReturnType<typeof playScenario>> | null = null;
      try {
        played = await playScenario(sc, key.raw, (label, actual, expected) => expect(actual, label).toEqual(expected));
      } finally {
        // playScenario seeds inside; find the world by tag via the clients it made.
        const clients = await prisma.client.findMany({ where: { name: { startsWith: 'Maple h' } }, select: { id: true, name: true } });
        void clients;
        if (played) await cleanupWorld(played.world);
      }
    });
  }
});
