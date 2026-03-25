# Phase 3: Proposals & MSA

## Overview
Add proposal creation/versioning/sending, MSA management, email integration, and public portal routes for client viewing/accepting proposals and signing MSAs.

## Files to Create

### Portal Infrastructure
- [ ] `/app/lib/services/portal.ts` — Token generation, validation, expiry helpers
- [ ] `/app/app/(portal)/layout.tsx` — Public portal layout (no auth, branded)
- [ ] `/app/app/(portal)/proposal/[token]/page.tsx` — Proposal view + accept/reject/changes
- [ ] `/app/app/(portal)/msa/[token]/page.tsx` — MSA view + sign

### API Routes
- [ ] `/app/app/api/accords/[id]/proposals/route.ts` — GET list, POST create new version
- [ ] `/app/app/api/accords/[id]/proposals/[proposalId]/route.ts` — GET detail, PATCH update draft
- [ ] `/app/app/api/accords/[id]/proposals/[proposalId]/send/route.ts` — POST send to client
- [ ] `/app/app/api/msa/route.ts` — GET list versions, POST create new version
- [ ] `/app/app/api/msa/[id]/route.ts` — GET detail, PATCH update
- [ ] `/app/app/api/msa/current/route.ts` — GET current version
- [ ] `/app/app/api/portal/proposals/[token]/route.ts` — GET proposal (public)
- [ ] `/app/app/api/portal/proposals/[token]/respond/route.ts` — POST accept/reject/changes (public)
- [ ] `/app/app/api/portal/msa/[token]/route.ts` — GET MSA (public)
- [ ] `/app/app/api/portal/msa/[token]/sign/route.ts` — POST sign MSA (public)
- [ ] `/app/app/api/clients/[id]/msa-status/route.ts` — GET client MSA signing status

### Hooks & Query Keys
- [ ] `/app/lib/hooks/use-proposals.ts` — React Query hooks for proposals
- [ ] `/app/lib/hooks/use-msa.ts` — React Query hooks for MSA versions

### Registry
- [ ] `/app/lib/api/registry/proposals.ts` — Proposal endpoint registry
- [ ] `/app/lib/api/registry/msa.ts` — MSA endpoint registry
- [ ] `/app/lib/api/registry/portal.ts` — Portal endpoint registry

### Components
- [ ] `/app/components/domain/proposals/ProposalEditor.tsx` — Draft editor (rich text + pricing)
- [ ] `/app/components/domain/proposals/ProposalVersionList.tsx` — Version history with status badges
- [ ] `/app/components/domain/proposals/ProposalPreview.tsx` — Rendered preview
- [ ] `/app/components/domain/msa/MsaEditor.tsx` — MSA content editor
- [ ] `/app/components/domain/msa/MsaVersionList.tsx` — Version list

### Tests
- [ ] `/app/app/api/accords/[id]/proposals/__tests__/route.test.ts`
- [ ] `/app/app/api/msa/__tests__/route.test.ts`
- [ ] `/app/app/api/portal/proposals/__tests__/route.test.ts`
- [ ] `/app/app/api/portal/msa/__tests__/route.test.ts`
- [ ] `/app/lib/services/__tests__/portal.test.ts`

## Files to Modify
- [ ] `/app/lib/api/formatters.ts` — Add formatProposalResponse, formatMsaVersionResponse, formatClientMsaSignatureResponse
- [ ] `/app/lib/api/query-keys.ts` — Add proposalKeys, msaKeys
- [ ] `/app/lib/api/registry/index.ts` — Import new registry files
- [ ] `/app/types/entities.ts` — Add Proposal, MsaVersion, ClientMsaSignature types
- [ ] `/app/lib/services/notifications.ts` — Add proposal/MSA notification triggers
- [ ] `/app/lib/services/email.ts` — Add proposal/MSA email templates (or new file)
- [ ] `/app/lib/services/activity.ts` — Extend EntityType with 'accord', 'proposal', 'msa'
- [ ] `/app/app/(app)/deals/[id]/page.tsx` — Add Proposal tab
- [ ] `/app/app/(app)/settings/page.tsx` — Add MSA management section (or new admin page)
- [ ] `/app/.env.local.example` — Add NEXT_PUBLIC_PORTAL_URL

## Implementation Steps

### Step 1: Portal Infrastructure
1. Create `portal.ts` service with:
   - `generatePortalToken()` — crypto.randomBytes(64).toString('hex') → 128 char token
   - `validatePortalToken(token, entityType)` — lookup token, check expiry, return entity
   - `logPortalSession(tokenType, entityId, ip, userAgent, action)` — create PortalSession record
   - Default expiry: 60 days from generation
2. Create portal layout — minimal, branded, no auth

### Step 2: Formatters & Types
1. Add formatProposalResponse, formatMsaVersionResponse, formatClientMsaSignatureResponse to formatters.ts
2. Add Proposal, MsaVersion, ClientMsaSignature interfaces to entities.ts
3. Add proposalKeys, msaKeys to query-keys.ts

### Step 3: MSA API
1. CRUD for MSA versions (Admin only)
2. `GET /api/msa/current` for quick access to active version
3. `GET /api/clients/[id]/msa-status` to check if client signed current MSA

### Step 4: Proposal API
1. `POST /api/accords/[id]/proposals` — Create new version (auto-increment version, snapshot pricing from line items)
2. `GET /api/accords/[id]/proposals` — List versions for an accord
3. `GET /api/accords/[id]/proposals/[id]` — Single proposal detail
4. `PATCH /api/accords/[id]/proposals/[id]` — Update draft only (reject if status != draft)
5. `POST /api/accords/[id]/proposals/[id]/send` — Generate portal token, set status to sent, set sent_at, send email

### Step 5: Portal API (Public — No Auth)
1. `GET /api/portal/proposals/[token]` — Validate token, check expiry, return proposal with accord info + pricing
2. `POST /api/portal/proposals/[token]/respond` — Accept/reject/request_changes with optional note
   - On accept: update proposal status, advance accord to 'contract' status
3. `GET /api/portal/msa/[token]` — Return MSA content
4. `POST /api/portal/msa/[token]/sign` — Record signature (name, email, IP, user agent)

### Step 6: Email Templates
1. Proposal sent email (to client/lead) with portal link
2. MSA signing request email with portal link
3. Internal notifications: proposal accepted/rejected/changes_requested → accord owner

### Step 7: Registry Updates
1. Create proposals.ts, msa.ts, portal.ts registry files
2. Import in index.ts
3. Update registry test expectedGroups

### Step 8: React Hooks
1. useProposals(accordId) — list
2. useProposal(accordId, proposalId) — detail
3. useCreateProposal() — mutation
4. useUpdateProposal() — mutation
5. useSendProposal() — mutation
6. useMsaVersions() — list
7. useCurrentMsa() — current version
8. useCreateMsaVersion() — mutation

### Step 9: Internal UI
1. Proposal tab on Accord detail (`/deals/[id]`):
   - Version list with status badges
   - Create new proposal button
   - Rich text editor for content
   - Preview mode
   - Send button with confirmation
2. MSA management (in admin/settings):
   - Version list
   - Create new version form
   - Set as current toggle

### Step 10: Portal UI
1. Proposal view page — rendered content, pricing table, action buttons
2. MSA view page — content, signer info fields, sign button

## Tests to Update (from Impact Analysis)
- [ ] `/app/lib/api/registry/__tests__/registry.test.ts` — Add 'proposals', 'msa', 'portal' to expectedGroups

## Tests to Write
- [ ] Proposal CRUD: create versioning, draft-only editing, status transitions
- [ ] Proposal send: token generation, email dispatch, status update
- [ ] Portal proposal: token validation, expiry, accept/reject/changes
- [ ] MSA CRUD: version management, current version, admin-only access
- [ ] Portal MSA: token validation, signature recording
- [ ] Portal service: token generation, validation, session logging

## Security Considerations
- Portal tokens: 128 chars, crypto-random, indexed in DB
- Token expiry: 60 days default, checked on every access
- No auth required for portal routes — security is token-only
- Log all portal access (IP, user agent, action) via PortalSession
- Rate limit portal endpoints (future — not Phase 3 blocker)
- Content snapshots on send (proposal) to preserve what was agreed to

## Verification Checklist
- [ ] All new API endpoints work (proposals CRUD, MSA CRUD, portal)
- [ ] Portal token generation and validation work correctly
- [ ] Proposal versioning increments correctly
- [ ] Proposal send generates token and dispatches email
- [ ] Portal accept advances accord status
- [ ] MSA signing creates ClientMsaSignature record
- [ ] Email falls back to console when SendGrid not configured
- [ ] TypeScript compiles without errors
- [ ] All new tests pass
- [ ] All existing 542 tests still pass
- [ ] Registry test updated and passing
