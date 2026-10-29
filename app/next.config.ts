import type { NextConfig } from "next";
import { execSync } from "node:child_process";

const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'origin-when-cross-origin',
  },
];

// Build id = git sha, so it is stable and known (CI sets GITHUB_SHA; local builds ask git).
// Exposed to the client as NEXT_PUBLIC_BUILD_ID for the stale-chunk reload guard.
function resolveBuildId(): string | null {
  const fromEnv = process.env.GITHUB_SHA?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}
const buildId = resolveBuildId();

const nextConfig: NextConfig = {
  // Playwright (PW_PORT != 3000) runs its own dev server beside another one in the same checkout; two
  // `next dev` processes cannot share one dist dir (lock). Unset = the default `.next`, nothing changes.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  generateBuildId: async () => buildId,
  env: buildId ? { NEXT_PUBLIC_BUILD_ID: buildId } : {},
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      // Documents must never be cached (prerendered pages ship s-maxage=31536000, so a stale HTML
      // shell would keep pointing at chunk hashes of an old build). /_next/static stays immutable.
      {
        source: '/((?!_next/).*)',
        headers: [{ key: 'Cache-Control', value: 'private, no-cache, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
