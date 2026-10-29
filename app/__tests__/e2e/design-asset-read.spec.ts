import { test, expect } from '@playwright/test';
import { newTag, seedWorld, teardownWorld, type DesignWorld } from './fixtures/design-portal-fixture';
import { DesignWorker } from './fixtures/design-worker';
import { BASE_URL, loginState, newPage, openTask, startPreview } from './fixtures/design-helpers';

// Regression: an asset the worker just uploaded (201) must be readable by the session's designer, and only by her.
test('designer reads a worker-uploaded asset; another designer gets 404', async ({ browser }) => {
  const world: DesignWorld = await seedWorld(newTag());
  const preview = await startPreview();
  try {
    const worker = new DesignWorker(BASE_URL, world);
    await worker.heartbeat();
    const stateA = await loginState(world.designerA.email, `${world.tag}-ra`);
    const stateB = await loginState(world.designerB.email, `${world.tag}-rb`);
    const a = await newPage(browser, stateA, preview.port);
    const sessionId = await openTask(a.page, world.tasks.a1.title);
    await worker.claimAndSetUp(sessionId);
    const assetId = await worker.uploadPng(sessionId, 'crop', 390);
    const url = `/api/design/sessions/${sessionId}/assets/${assetId}`;
    const mine = await a.page.request.get(url);
    expect(mine.status()).toBe(200);
    expect(mine.headers()['content-type']).toBe('image/png');
    expect((await mine.body()).subarray(1, 4).toString()).toBe('PNG');
    const w = await worker.api('GET', `/api/design/worker/sessions/${sessionId}/assets/${assetId}`);
    expect(w.status).toBe(200);
    await a.context.close();
    const b = await newPage(browser, stateB, preview.port);
    expect((await b.page.request.get(url)).status()).toBe(404);
    await b.context.close();
  } finally {
    await preview.close();
    await teardownWorld(world);
  }
});
