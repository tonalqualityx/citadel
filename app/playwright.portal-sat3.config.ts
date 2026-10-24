import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Saturday 10-24 run, item 3: the flags-ON Retainer and Home screens. Same server and setup as the
// main config; the screens go to a separate folder so the portal-design baselines are never touched.
export default defineConfig({
  ...base,
  fullyParallel: false,
  snapshotPathTemplate: '/home/mike/Documents/indelible-ops/docs/overnight/portal-redesign/screens-sat3/{arg}{ext}',
  reporter: [['list']],
});
