# Indelible App: Testing Strategy
## Phase 4.2 Operational Planning Document

**Version:** 1.0  
**Date:** December 2024  
**Status:** ✅ Complete

---

## Overview

This document defines the testing approach for Indelible, balancing thoroughness with practical constraints of a small team. The strategy prioritizes testing critical user flows over exhaustive coverage.

### Testing Philosophy

| Principle | Approach |
|-----------|----------|
| **Test the flows, not the functions** | E2E tests for critical paths; unit tests for complex logic |
| **Manual testing is valid** | Some things are faster to click through than automate |
| **Test what breaks** | Focus on state transitions, edge cases, and integrations |
| **UAT is just you** | Mike validates before go-live; team validates in production |

---

## Testing Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                        E2E TESTS                                │
│         (Critical user flows - Playwright or Cypress)           │
│                    ~10-15 test scenarios                        │
├─────────────────────────────────────────────────────────────────┤
│                    INTEGRATION TESTS                            │
│           (API endpoints - Supertest or similar)                │
│                   ~30-50 test cases                             │
├─────────────────────────────────────────────────────────────────┤
│                      UNIT TESTS                                 │
│         (Complex business logic - Vitest or Jest)               │
│                   ~50-100 test cases                            │
├─────────────────────────────────────────────────────────────────┤
│                    MANUAL TESTING                               │
│              (UI polish, edge cases, UX feel)                   │
│                      Checklist-based                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Unit Testing

### What to Unit Test

Focus unit tests on **complex business logic** that's easy to get wrong:

| Area | Examples |
|------|----------|
| Energy calculations | Weighted energy, mystery factor multipliers, variance |
| Status transitions | Valid state changes, blocked/unblocked logic |
| Permission checks | Role-based field visibility, action authorization |
| Date/time logic | Retainer period calculations, due date handling |
| Recipe task generation | Variable task creation from sitemap input |
| Notification bundling | Grouping logic, deduplication |

### What NOT to Unit Test

- Simple CRUD operations (covered by integration tests)
- UI components without complex logic (covered by E2E)
- Framework/library code
- Getter/setter functions

### Coverage Target

**Target: 80% coverage on business logic modules**

Focus areas:
- `/lib/calculations/` — 90%+ coverage
- `/lib/permissions/` — 90%+ coverage
- `/lib/notifications/` — 80%+ coverage
- `/api/` route handlers — 60%+ (integration tests cover the rest)

### Example Unit Tests

```javascript
// Energy calculation tests
describe('calculateWeightedEnergy', () => {
  it('returns base energy when mystery factor is None', () => {
    expect(calculateWeightedEnergy(4, 'none')).toBe(4);
  });
  
  it('applies 1.4x multiplier for Average mystery factor', () => {
    expect(calculateWeightedEnergy(4, 'average')).toBe(5.6);
  });
  
  it('applies 1.75x multiplier for Significant mystery factor', () => {
    expect(calculateWeightedEnergy(4, 'significant')).toBe(7);
  });
  
  it('applies 2.5x multiplier for No Idea mystery factor', () => {
    expect(calculateWeightedEnergy(4, 'no_idea')).toBe(10);
  });
});

// Task status transition tests
describe('canTransitionTaskStatus', () => {
  it('allows not_started → in_progress', () => {
    expect(canTransitionTaskStatus('not_started', 'in_progress')).toBe(true);
  });
  
  it('prevents done → in_progress without explicit reopen', () => {
    expect(canTransitionTaskStatus('done', 'in_progress')).toBe(false);
  });
  
  it('allows any status → abandoned', () => {
    expect(canTransitionTaskStatus('in_progress', 'abandoned')).toBe(true);
    expect(canTransitionTaskStatus('review', 'abandoned')).toBe(true);
  });
});
```

---

## Integration Testing

### Scope

Integration tests verify API endpoints work correctly with the database. Each endpoint tested for:
- Happy path (valid request → expected response)
- Authentication (no token → 401)
- Authorization (wrong role → 403)
- Validation (bad input → 400 with error details)
- Edge cases (empty results, not found, etc.)

### Priority Endpoints

**High Priority (must test):**

| Endpoint | Key Scenarios |
|----------|---------------|
| `POST /auth/login` | Valid credentials, invalid credentials, rate limiting |
| `POST /projects` | Create with recipe, create blank, validation |
| `POST /projects/:id/generate-tasks` | Recipe expansion, sitemap variable tasks |
| `PATCH /tasks/:id/status` | All valid transitions, blocked task handling |
| `POST /time-entries` | Create, validate against task, timer start/stop |
| `GET /dashboard/:role` | Tech, PM, Admin variations |
| `GET /tasks` | Filtering, visibility based on project status |

**Medium Priority:**

| Endpoint | Key Scenarios |
|----------|---------------|
| `POST /clients` | Create direct, agency partner, sub-client |
| `POST /sites` | Create, link to client/plans |
| `PATCH /projects/:id` | Status changes, notification triggers |
| `GET /reports/*` | Time reports, retainer reports |

**Lower Priority (manual test is fine):**

- Settings endpoints
- User preferences
- Notification mark-as-read
- Comment CRUD

### Example Integration Tests

```javascript
describe('POST /api/tasks/:id/status', () => {
  it('transitions task from not_started to in_progress', async () => {
    const task = await createTestTask({ status: 'not_started' });
    
    const response = await request(app)
      .patch(`/api/tasks/${task.id}/status`)
      .set('Authorization', `Bearer ${techUserToken}`)
      .send({ status: 'in_progress' });
    
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('in_progress');
  });
  
  it('rejects transition when task is blocked', async () => {
    const blocker = await createTestTask({ status: 'in_progress' });
    const task = await createTestTask({ 
      status: 'not_started',
      blocked_by: [blocker.id]
    });
    
    const response = await request(app)
      .patch(`/api/tasks/${task.id}/status`)
      .set('Authorization', `Bearer ${techUserToken}`)
      .send({ status: 'in_progress' });
    
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('blocked');
  });
  
  it('requires authentication', async () => {
    const response = await request(app)
      .patch('/api/tasks/123/status')
      .send({ status: 'in_progress' });
    
    expect(response.status).toBe(401);
  });
});
```

---

## End-to-End Testing

### Tool Recommendation

**Playwright** — Better debugging, multiple browsers, good docs.

Alternative: Cypress if you prefer its syntax/ecosystem.

### Critical Path Tests

These E2E tests cover the most important user journeys:

---

#### E2E-1: Authentication Flow

```
1. Navigate to /login
2. Enter valid credentials
3. Assert redirect to dashboard
4. Assert user menu shows correct name
5. Click logout
6. Assert redirect to login
7. Assert protected route redirects to login
```

---

#### E2E-2: Project Creation via Recipe Wizard

```
1. Login as PM
2. Navigate to /pacts
3. Click "New Pact"
4. Select "Use Wizard"
5. Select a recipe
6. Select existing patron
7. Select existing site
8. Enter sitemap pages (if variable tasks)
9. Assign team members to functions
10. Review summary
11. Click "Create Project"
12. Assert redirect to new project detail
13. Assert correct number of tasks created
14. Assert project status is "Quote"
15. Assert tasks are NOT visible in Tech dashboard
```

---

#### E2E-3: Task Lifecycle (Happy Path)

```
1. Login as PM
2. Change project status to "In Progress"
3. Logout
4. Login as Tech
5. Assert task appears in "My Quests"
6. Click task to open
7. Start timer
8. Assert status changed to "In Progress"
9. Stop timer after a few seconds
10. Assert time entry created
11. Click "Submit for Review"
12. Assert status is "Review"
13. Logout
14. Login as PM
15. Assert task appears in "Awaiting Review"
16. Open task
17. Click "Approve"
18. Assert status is "Done"
19. Assert task no longer in "Awaiting Review"
```

---

#### E2E-4: Time Tracking

```
1. Login as Tech
2. Open a task
3. Start timer
4. Assert timer widget shows in header
5. Navigate to different page
6. Assert timer still visible
7. Return to task
8. Stop timer
9. Assert time entry modal appears with correct duration
10. Adjust duration if needed
11. Save entry
12. Assert entry appears in task time log
13. Open time entry modal manually
14. Create manual entry for different task
15. Assert entry appears in that task
```

---

#### E2E-5: Blocked Task Handling

```
1. Login as PM
2. Create two tasks: Task A and Task B
3. Set Task B blocked by Task A
4. Logout
5. Login as Tech (assigned to both)
6. Assert Task B shows "Blocked" indicator
7. Assert cannot start work on Task B
8. Open Task A
9. Complete Task A
10. Navigate to Task B
11. Assert Task B now shows "Ready"
12. Assert can start work on Task B
```

---

#### E2E-6: Retainer Monitoring

```
1. Login as PM
2. Navigate to patron with retainer hours
3. Assert retainer meter shows correct usage
4. Create a retainer task with energy estimate
5. Assert retainer "planned" updates
6. Complete time entry on task
7. Assert retainer "used" updates
8. Assert warning appears if over threshold
```

---

#### E2E-7: Permission Boundaries

```
1. Login as Tech
2. Navigate to /settings/users
3. Assert 403 or redirect (not accessible)
4. Navigate to patron detail
5. Assert billing rate is hidden
6. Attempt to access PM-only endpoint via URL
7. Assert blocked
8. Logout
9. Login as PM
10. Assert can see billing rate
11. Assert can access PM routes
```

---

### E2E Test Maintenance

Keep E2E tests maintainable:
- Use data-testid attributes for selectors
- Create test fixtures (seed data) that reset between tests
- Use Page Object pattern for common interactions
- Run against seeded test database, not production

---

## Manual Testing Checklist

Some things are faster or better to test manually:

### Pre-Release Checklist

**Authentication & Session**
- [ ] Login with valid credentials
- [ ] Login with invalid credentials shows error
- [ ] Session persists across page refresh
- [ ] Session timeout after inactivity
- [ ] Logout clears session

**Dashboard (each role)**
- [ ] Tech: My Quests loads correctly
- [ ] Tech: Timer widget functional
- [ ] PM: Focus Quests shows correct items
- [ ] PM: Awaiting Review section accurate
- [ ] PM: Retainer alerts appear when appropriate
- [ ] Admin: All PM features plus admin sections

**Navigation**
- [ ] Sidebar navigation works
- [ ] Breadcrumbs accurate
- [ ] Global search finds entities
- [ ] Recent items updates
- [ ] Role-appropriate menu items only

**Entity CRUD (spot check each)**
- [ ] Create patron
- [ ] Edit patron
- [ ] Create site linked to patron
- [ ] Create project (wizard and blank)
- [ ] Create ad-hoc task
- [ ] Edit task inline

**Time Tracking**
- [ ] Timer start/stop
- [ ] Timer persists across navigation
- [ ] Manual time entry
- [ ] Edit time entry
- [ ] Delete time entry

**Visual Polish**
- [ ] No layout breaks at common viewport sizes
- [ ] Loading states appear (not blank screens)
- [ ] Error states show helpful messages
- [ ] Empty states have appropriate messaging
- [ ] Color contrast acceptable (neurodivergent considerations)

**Edge Cases**
- [ ] Very long entity names don't break layout
- [ ] Special characters in names handled
- [ ] Rapid clicks don't create duplicates
- [ ] Browser back button behaves sensibly

---

## UAT Plan

### Participants

| Role | Person | Focus Area |
|------|--------|------------|
| UAT Lead | Mike | All flows, final approval |

### UAT Scope

Given small team and Mike as sole tester, UAT is informal but structured:

**Week -2 (before go-live):**
1. Run through all E2E test scenarios manually
2. Complete manual testing checklist
3. Create test patron, site, project, tasks
4. Complete full task lifecycle
5. Verify time tracking and reports

**Week -1:**
1. Fix any issues found
2. Re-test fixed items
3. Final walkthrough of critical flows
4. Sign-off for production deployment

### UAT Acceptance Criteria

| Category | Criteria |
|----------|----------|
| Critical | All E2E scenarios pass (automated or manual) |
| Critical | No data loss scenarios identified |
| Critical | Authentication/authorization working |
| Major | All manual checklist items pass |
| Major | Performance acceptable (<3s page loads) |
| Minor | Visual polish issues documented for post-launch |

---

## Test Data Management

### Development Environment

```sql
-- Seed script creates:
-- 3 test clients (direct, agency partner, sub-client)
-- 5 test sites
-- 2 test projects (different statuses)
-- 10-15 test tasks across projects
-- Test users (1 tech, 1 PM, 1 admin)
-- Sample time entries
-- Sample SOPs and recipes
```

### Test Environment Reset

```bash
# Reset test database to clean seed state
npm run db:reset:test

# Or via psql
psql $TEST_DATABASE_URL -f scripts/seed-test-data.sql
```

### Production-Like Testing

Before go-live, import migrated Notion data to staging environment and test with real data shapes/volumes.

---

## CI/CD Integration

### On Every Pull Request

```yaml
# .github/workflows/test.yml
- Run linter
- Run unit tests
- Run integration tests
- Report coverage
```

### On Merge to Main

```yaml
- All PR checks
- Run E2E tests against staging
- Deploy to staging if all pass
```

### Pre-Production Deploy

```yaml
- Manual trigger
- Full E2E suite against staging
- Require approval
- Deploy to production
```

---

## Tooling Summary

| Purpose | Recommended Tool |
|---------|------------------|
| Unit tests | Vitest (faster) or Jest |
| Integration tests | Vitest + Supertest |
| E2E tests | Playwright |
| Coverage reporting | Built-in (Vitest/Jest) + Codecov |
| CI/CD | GitHub Actions |

---

## Related Documents

- `indelible-user-flows.md` — Detailed flow narratives for test scenarios
- `indelible-api-endpoint-inventory.md` — Complete endpoint list for integration tests
- `indelible-screen-inventory.md` — All screens for E2E coverage

---