# Feature: BrandProfile model (voice + branding storage)

Citadel task `ed24d77e` (Tier 2 of `feature-planning/bast-work-support-design.md`).
Mike confirmed: **per-field cascade** (site overrides the fields it sets, inherits the rest from
client) + **freeform JSON** `brand_tokens` for v1.

## Overview
A per-owner `BrandProfile` (polymorphic: nullable `client_id` XOR `site_id`, one profile per owner)
holding `voice_profile` (JSON), `figma_url`, `component_library_ref`, `brand_tokens` (freeform JSON),
`notes`. A site's *effective* profile resolves per-field: own value where set, else the client's.
Brand tab on both the Client page and the Site page; the Site tab shows inherited client values.

## Files to Create
- [ ] `prisma/migrations/20260622000000_brand_profile/migration.sql` — additive table + FKs + indexes + owner CHECK
- [ ] `lib/calculations/brand-profile.ts` — `resolveBrandProfile(site, client)` per-field cascade
- [ ] `lib/calculations/__tests__/brand-profile.test.ts` — cascade unit tests
- [ ] `app/api/clients/[id]/brand-profile/route.ts` — GET + PUT (upsert) client profile
- [ ] `app/api/sites/[id]/brand-profile/route.ts` — GET (own + inherited + resolved) + PUT (upsert)
- [ ] `app/api/sites/[id]/brand-profile/__tests__/route.test.ts` — get/upsert + resolution
- [ ] `app/api/clients/[id]/brand-profile/__tests__/route.test.ts` — get/upsert
- [ ] `lib/api/registry/brand-profiles.ts` — registry entries
- [ ] `lib/hooks/use-brand-profile.ts` — query + upsert hooks
- [ ] `components/domain/brand/brand-tab.tsx` — reusable Brand tab (client | site owner)

## Files to Modify
- [ ] `prisma/schema.prisma` — `BrandProfile` model + back-relations on `Client`/`Site`
- [ ] `lib/api/formatters.ts` — `formatBrandProfileResponse()`
- [ ] `lib/api/registry/index.ts` — import + spread `brandProfileEndpoints`
- [ ] `lib/services/activity.ts` — add `'brand_profile'` to `EntityType`
- [ ] `lib/api/query-keys.ts` — `brandProfileKeys`
- [ ] `types/entities.ts` — BrandProfile types
- [ ] `app/(app)/clients/[id]/page.tsx` — add `brand` tab
- [ ] `app/(app)/sites/[id]/page.tsx` — add Details/Brand tab nav, mount Brand tab

## Implementation Notes
- One profile per owner: `@@unique([client_id])` + `@@unique([site_id])` (Postgres NULLs distinct →
  many site rows with null client_id are fine). DB CHECK `(client_id IS NOT NULL) <> (site_id IS NOT NULL)`
  guarantees exactly-one-owner. Prisma ignores CHECK constraints → no migrate drift.
- JSON nulls: map incoming `null` for `voice_profile`/`brand_tokens` to `Prisma.DbNull`.
- Upsert (PUT) is the create+update path — no separate POST/DELETE in v1 (clearing fields to null is
  the "delete"). Reversible, smallest surface.
- `voice_profile`: prose stored as a JSON string (textarea). `brand_tokens`: JSON textarea, parsed +
  validated on save.
- Resolution returns `{ field: { value, source: 'site'|'client'|null } }` for the gates + UI.

## Tests to Update (from Impact Analysis)
- None. BrandProfile is purely additive — no existing caller, type, or test references it. The new
  `Client`/`Site` back-relations are optional and don't change existing `include`/response shapes.

## Tests to Write
- [ ] `resolveBrandProfile`: site-only, client-only, per-field mix, both-null, source labels
- [ ] PUT client brand-profile creates then updates; GET returns profile
- [ ] PUT site brand-profile; GET returns own + inherited + resolved with correct per-field source
- [ ] 404 when owner missing; brand_tokens invalid-JSON rejected (handled at Zod/route)

## Verification Checklist
- [ ] `npx prisma generate` + migration applies via `prisma migrate deploy`
- [ ] `npx tsc --noEmit` clean
- [ ] Full `vitest run` green (zero broken)
- [ ] `next build` succeeds
- [ ] One reversible commit; CI green after push (auto_deploy → prod)
</content>
</invoke>
