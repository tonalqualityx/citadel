import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// The portal design pass: same server and setup as the main config, with the screenshot baselines
// written to (and compared against) the indelible-ops screens folder.
export default defineConfig({
  ...base,
  fullyParallel: false,
  // PORTAL_SCREENS_DIR writes a separate set of screens (used with PORTAL_RETAINER_APPROVED=1 so the
  // baselines in screens/ are never overwritten by a run that seeds extra content).
  snapshotPathTemplate: `${process.env.PORTAL_SCREENS_DIR ?? '/home/mike/Documents/indelible-ops/docs/overnight/portal-redesign/screens'}/{arg}{ext}`,
  reporter: [['list']],
});
