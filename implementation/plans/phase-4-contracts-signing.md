# Phase 4: Contracts & Signing

## Overview
Contract generation from accepted proposals, client signing flow via portal, content snapshots for immutability, and onboarding flow to convert leads into clients.

## Scope Decisions
- **PDF generation deferred** — Puppeteer is heavyweight. We'll add a download endpoint later that renders HTML-to-PDF. The contract content itself is stored as HTML.
- **Activation flow (4.7)** is manual for now — payment confirmed toggle on accord advances to `active`. Charter/Commission creation is Phase 5.
- **Addendum CRUD** deferred to Phase 6 per build plan — schema exists, code doesn't yet.

## Files to Create

### Services
- [ ] `/lib/services/contract-generator.ts` — Assembles contract HTML from Ware contract language + line item pricing + MSA reference

### API Routes
- [ ] `/app/api/accords/[id]/contracts/route.ts` — GET (list) + POST (generate)
- [ ] `/app/api/accords/[id]/contracts/[contractId]/route.ts` — GET (detail) + PATCH (edit draft) + DELETE (soft delete)
- [ ] `/app/api/accords/[id]/contracts/[contractId]/send/route.ts` — POST (generate token, send email)
- [ ] `/app/api/portal/contracts/[token]/route.ts` — GET (view contract, public)
- [ ] `/app/api/portal/contracts/[token]/sign/route.ts` — POST (sign contract, public)
- [ ] `/app/api/portal/onboard/[token]/route.ts` — GET (view) + POST (submit onboarding info)

### Portal Pages
- [ ] `/app/(portal)/portal/contract/[token]/page.tsx` — Contract signing page
- [ ] `/app/(portal)/portal/onboard/[token]/page.tsx` — Lead onboarding page

### Registry
- [ ] `/lib/api/registry/contracts.ts` — All contract + portal contract endpoints
- [ ] `/lib/api/registry/onboarding.ts` — Onboarding portal endpoints

### Hooks
- [ ] `/lib/hooks/use-contracts.ts` — React Query hooks for contracts

### Tests
- [ ] `/app/api/accords/[id]/contracts/__tests__/route.test.ts`
- [ ] `/app/api/portal/contracts/__tests__/route.test.ts`
- [ ] `/lib/services/__tests__/contract-generator.test.ts`

## Files to Modify
- [ ] `/lib/api/formatters.ts` — Add `formatContractResponse()`
- [ ] `/lib/api/query-keys.ts` — Add `contractKeys`
- [ ] `/lib/api/registry/index.ts` — Import + register contracts, onboarding
- [ ] `/lib/services/portal.ts` — Add `validateContractToken()`, add 'onboard' token type
- [ ] `/types/entities.ts` — Add Contract interface
- [ ] `/lib/services/notifications.ts` — Add contract notification types

## Tests to Update (from Impact Analysis)
- [ ] `/lib/api/registry/__tests__/registry.test.ts` — Add 'contracts' to expectedGroups
- [ ] `/app/api/accords/__tests__/route.test.ts` — May need status transition adjustments if contract→signed is validated

## Implementation Steps

### Step 1: Foundation (types, formatters, query keys, portal service)
1. Add Contract type to `entities.ts`
2. Add `formatContractResponse()` to formatters
3. Add `contractKeys` to query-keys
4. Add `validateContractToken()` to portal.ts
5. Add contract notification functions

### Step 2: Contract Generator Service
1. `generateContractContent(accordId)` — assembles HTML from line items + ware contract language
2. Creates pricing snapshot from current line items
3. References current MSA version

### Step 3: Contract CRUD API
1. POST — generate contract (calls generator, creates record)
2. GET list — all contracts for accord
3. GET detail — single contract
4. PATCH — edit draft content
5. DELETE — soft delete

### Step 4: Contract Send API
1. Generate portal token
2. Update contract status → sent, store token
3. Send email to lead/client
4. Create content_snapshot (immutable record of what was sent)

### Step 5: Contract Portal Routes
1. GET /api/portal/contracts/:token — return contract for signing
2. POST /api/portal/contracts/:token/sign — sign contract, capture signer info, advance accord

### Step 6: Contract Portal Page
1. Client-facing signing UI
2. MSA section if not yet signed
3. Signer info form
4. Sign button with confirmation

### Step 7: Onboarding Flow
1. POST /api/portal/onboard/:token — creates Client from lead info
2. Portal page for collecting business info
3. Links new client to accord

### Step 8: Registry + Hooks
1. Create registry file with all endpoints
2. Create React Query hooks
3. Register in index

### Step 9: Tests
1. Contract CRUD route tests
2. Portal contract route tests
3. Contract generator service tests
4. Update registry tests
5. Run full suite

## Verification Checklist
- [ ] Contracts auto-generated from accord line items + ware contract language
- [ ] Draft contracts editable before sending
- [ ] Send flow generates token, sends email, creates content snapshot
- [ ] Client can view contract via portal link
- [ ] Client can sign contract (captures name, email, IP, user agent)
- [ ] Signing creates immutable content_snapshot
- [ ] Signing advances accord to 'signed' status
- [ ] Onboarding captures lead info and creates Client
- [ ] TypeScript compiles without errors
- [ ] All tests pass (new + existing)
