import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// The portal design pass: same server and setup as the main config, with the screenshot baselines
// written to (and compared against) the indelible-ops screens folder.
export default defineConfig({
  ...base,
  fullyParallel: false,
  snapshotPathTemplate: '/home/mike/Documents/indelible-ops/docs/overnight/portal-redesign/screens/{arg}{ext}',
  reporter: [['list']],
});
