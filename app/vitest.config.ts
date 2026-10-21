import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // The real-database tests (scratch DATABASE_URL only) share global state: the engine queue, the
    // settings singleton. They run one file at a time; mocked suites are unaffected.
    fileParallelism: !/scratch/i.test(process.env.DATABASE_URL ?? ''),
    exclude: [
      '**/node_modules/**',
      '**/e2e/**',
      '**/*.spec.ts',  // Playwright uses .spec.ts
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
