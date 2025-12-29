# Phase 10: Testing & Deployment
## Detailed Implementation Guide for Claude Code

**Phase:** 10 of 10  
**Estimated Duration:** 3-4 days  
**Prerequisites:** Phases 1-9 complete

---

## 🎯 Phase Goal

Finalize testing, prepare for production, and deploy. By the end of this phase:
- All critical paths have E2E tests
- Performance is optimized
- Security hardening is complete
- CI/CD pipeline is configured
- Application is deployed to production

---

## 📚 Required Reading

| Document | Sections to Focus On |
|----------|---------------------|
| `indelible-testing-strategy.md` | Full document |
| `indelible-deployment-devops.md` | Full document |
| `indelible-migration-runbook.md` | Data migration steps |

---

## 📋 Phase Checklist

### 10.1 Complete Test Coverage

#### 10.1.1 E2E Test Suite
**Install Playwright:**
```bash
npm install -D @playwright/test
npx playwright install
```

**Configure Playwright:**
**Create `playwright.config.ts`:**
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './__tests__/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

#### 10.1.2 Critical Path E2E Tests
- [ ] `/__tests__/e2e/auth.spec.ts` — Login, logout, session refresh
- [ ] `/__tests__/e2e/projects.spec.ts` — Create project via wizard
- [ ] `/__tests__/e2e/tasks.spec.ts` — Create task, change status
- [ ] `/__tests__/e2e/time-tracking.spec.ts` — Start/stop timer
- [ ] `/__tests__/e2e/search.spec.ts` — Global search

**Example E2E Test:**
```typescript
// __tests__/e2e/auth.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('should login with valid credentials', async ({ page }) => {
    await page.goto('/login');
    
    await page.fill('input[id="email"]', 'tech@indelible.agency');
    await page.fill('input[id="password"]', 'password123');
    await page.click('button[type="submit"]');
    
    await expect(page).toHaveURL('/overlook');
    await expect(page.locator('text=Overlook')).toBeVisible();
  });

  test('should reject invalid credentials', async ({ page }) => {
    await page.goto('/login');
    
    await page.fill('input[id="email"]', 'tech@indelible.agency');
    await page.fill('input[id="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    
    await expect(page.locator('text=Invalid credentials')).toBeVisible();
  });

  test('should redirect unauthenticated users to login', async ({ page }) => {
    await page.goto('/overlook');
    await expect(page).toHaveURL('/login');
  });

  test('should logout and redirect to login', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('input[id="email"]', 'tech@indelible.agency');
    await page.fill('input[id="password"]', 'password123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/overlook');
    
    // Logout
    await page.click('[data-testid="user-menu"]');
    await page.click('text=Sign out');
    
    await expect(page).toHaveURL('/login');
  });
});
```

#### 10.1.3 Coverage Report
- [ ] Run: `npm run test:coverage`
- [ ] Verify coverage targets met:
  - Calculations: 90%+
  - Auth: 90%+
  - API Routes: 80%+
  - Components: 60%+

---

### 10.2 Performance Optimization

#### 10.2.1 Database Optimization
- [ ] Add missing indexes identified by query analysis
- [ ] Implement connection pooling for production
- [ ] Review N+1 queries and optimize with includes

**Create `/lib/db/prisma-production.ts`:**
```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'error', 'warn'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

#### 10.2.2 Frontend Optimization
- [ ] Lazy load non-critical components
- [ ] Optimize images with Next.js Image
- [ ] Add loading.tsx for route segments
- [ ] Implement proper Suspense boundaries

**Create `/app/(app)/loading.tsx`:**
```tsx
export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600"></div>
    </div>
  );
}
```

#### 10.2.3 API Optimization
- [ ] Add response caching headers where appropriate
- [ ] Implement pagination for all list endpoints
- [ ] Add query timeout limits

---

### 10.3 Security Hardening

#### 10.3.1 Security Headers
**Update `next.config.js`:**
```javascript
const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on'
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload'
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block'
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN'
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'Referrer-Policy',
    value: 'origin-when-cross-origin'
  },
];

module.exports = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};
```

#### 10.3.2 Security Checklist
- [ ] All passwords hashed with bcrypt (cost factor 10+)
- [ ] JWT secrets are strong (32+ characters)
- [ ] HTTP-only cookies for tokens
- [ ] CSRF protection on forms
- [ ] Input validation on all endpoints
- [ ] SQL injection protection (Prisma handles this)
- [ ] Rate limiting on auth endpoints
- [ ] Sensitive data not logged

#### 10.3.3 Rate Limiting
**Install rate limiter:**
```bash
npm install express-rate-limit
```

**Create `/lib/api/rate-limit.ts`:**
```typescript
import { NextRequest, NextResponse } from 'next/server';

const rateLimitMap = new Map<string, { count: number; lastReset: number }>();

export function rateLimit(
  request: NextRequest,
  limit: number = 100,
  windowMs: number = 60000
): NextResponse | null {
  const ip = request.ip || 'unknown';
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.lastReset > windowMs) {
    rateLimitMap.set(ip, { count: 1, lastReset: now });
    return null;
  }

  if (entry.count >= limit) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429 }
    );
  }

  entry.count++;
  return null;
}
```

---

### 10.4 CI/CD Pipeline

#### 10.4.1 GitHub Actions Workflow
**Create `.github/workflows/ci.yml`:**
```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: indelible_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Generate Prisma Client
        run: npx prisma generate
      
      - name: Run migrations
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/indelible_test
      
      - name: Run linter
        run: npm run lint
      
      - name: Run unit tests
        run: npm run test:unit
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/indelible_test
          JWT_SECRET: test-secret-key-for-ci-testing-only
          JWT_REFRESH_SECRET: test-refresh-secret-for-ci-only
      
      - name: Run integration tests
        run: npm run test:integration
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/indelible_test
          JWT_SECRET: test-secret-key-for-ci-testing-only
          JWT_REFRESH_SECRET: test-refresh-secret-for-ci-only

  build:
    runs-on: ubuntu-latest
    needs: test
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Generate Prisma Client
        run: npx prisma generate
      
      - name: Build
        run: npm run build
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

  deploy:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'
    
    steps:
      - uses: actions/checkout@v4
      
      # Add deployment steps for Cloudways
      - name: Deploy to production
        run: echo "Add deployment commands here"
```

#### 10.4.2 Pre-commit Hooks
**Install Husky:**
```bash
npm install -D husky lint-staged
npx husky install
```

**Create `.husky/pre-commit`:**
```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx lint-staged
```

**Add to `package.json`:**
```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  }
}
```

---

### 10.5 Production Environment

#### 10.5.1 Environment Variables
**Create production `.env` template:**
```env
# Database (Cloudways PostgreSQL)
DATABASE_URL="postgresql://user:password@host:5432/indelible_prod"

# Auth (Generate secure secrets)
JWT_SECRET="[generate-32+-char-secret]"
JWT_REFRESH_SECRET="[generate-32+-char-secret]"
JWT_ACCESS_EXPIRY="15m"
JWT_REFRESH_EXPIRY="7d"

# App
NEXT_PUBLIC_APP_URL="https://app.indelible.agency"
NODE_ENV="production"
```

#### 10.5.2 Cloudways Setup
- [ ] Create new application on Cloudways
- [ ] Configure PostgreSQL database
- [ ] Set up SSL certificate
- [ ] Configure environment variables
- [ ] Set up deployment SSH key

#### 10.5.3 Database Migration Script
**Create `scripts/deploy.sh`:**
```bash
#!/bin/bash
set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Building application..."
npm run build

echo "Restarting application..."
pm2 restart indelible || pm2 start npm --name "indelible" -- start

echo "Deployment complete!"
```

---

### 10.6 Data Migration

#### 10.6.1 Migration Scripts
Following the migration runbook:

- [ ] Export clients from Notion
- [ ] Transform to Prisma seed format
- [ ] Export sites and domains
- [ ] Export hosting/maintenance plans
- [ ] Export SOPs
- [ ] Export team/users
- [ ] Run migration in staging first
- [ ] Verify data integrity
- [ ] Run migration in production

#### 10.6.2 Migration Verification
- [ ] All clients imported correctly
- [ ] All sites linked to clients
- [ ] All domains linked to sites
- [ ] Reference data in place
- [ ] User accounts created

---

### 10.7 Launch Checklist

#### 10.7.1 Pre-Launch
- [ ] All tests passing
- [ ] Build succeeds without errors
- [ ] No critical security vulnerabilities
- [ ] Performance acceptable (Lighthouse score 80+)
- [ ] Mobile responsive
- [ ] Browser testing (Chrome, Firefox, Safari)
- [ ] Data migration complete
- [ ] Backup configured
- [ ] Monitoring in place (Sentry, logs)
- [ ] Domain configured
- [ ] SSL working

#### 10.7.2 Launch
- [ ] Deploy to production
- [ ] Run smoke tests
- [ ] Verify auth flow
- [ ] Verify core functionality
- [ ] Monitor error logs
- [ ] Monitor performance

#### 10.7.3 Post-Launch
- [ ] Monitor for 24 hours
- [ ] Address any critical issues
- [ ] Gather user feedback
- [ ] Document known issues
- [ ] Plan iteration cycle

---

## 🧪 Testing Commands

```bash
# Run all tests
npm run test

# Run unit tests only
npm run test:unit

# Run integration tests only
npm run test:integration

# Run E2E tests
npm run test:e2e

# Run E2E tests with UI
npm run test:e2e:ui

# Generate coverage report
npm run test:coverage

# Run linter
npm run lint

# Build for production
npm run build
```

---

## âœ… Phase 10 Acceptance Criteria

### Testing
- [ ] All E2E tests pass
- [ ] Coverage targets met
- [ ] No critical bugs in test suite

### Performance
- [ ] Lighthouse performance score 80+
- [ ] API response times < 200ms
- [ ] Database queries optimized

### Security
- [ ] Security headers configured
- [ ] Rate limiting in place
- [ ] No exposed secrets

### Deployment
- [ ] CI/CD pipeline working
- [ ] Production environment configured
- [ ] Data migration complete
- [ ] Application accessible at production URL

---

## 🎰 Project Complete

Congratulations! The Indelible application is now:
- Fully functional with all planned features
- Tested and verified
- Deployed to production
- Ready for users

### Post-Launch Priorities
1. Monitor performance and errors
2. Gather user feedback
3. Address any discovered issues
4. Plan Phase 2 features (if any)

---

*Phase 10 Document — Last Updated: December 2025*