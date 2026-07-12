# Feature: HTML validation on client edits (WordPress bodies)

## Overview
For WordPress-hosted sites, `Article.body` is stored/rendered HTML. Today the portal PATCH
save-edits path (`app/api/portal/articles/[id]/route.ts`) accepts any string up to 100k chars,
so a client could hand-edit the body into broken markup (unclosed tag, mismatched nesting) that
then breaks the published page. This adds a dependency-free structural well-formedness check,
run only when the body is HTML, that rejects (400) with a human-readable message before saving.

Approval: granted (per task brief). Proceeding straight to implementation.

## Impact Analysis (existing callers/tests)
- `app/api/portal/articles/[id]/route.ts` PATCH — the only write path being changed.
- `lib/articles/portal-actions.ts` `loadActionableArticle` — shared loader used by PATCH,
  `approve/route.ts`, and `request-changes/route.ts`. Extending its select to include the
  article's `site.site_type` (for the WordPress detection) and flattening it onto the returned
  `ActionableArticle` as `site_type: string | null`. This is additive (new field) and defensively
  coded (`article.site?.site_type ?? null`) so existing test mocks that resolve a `findFirst` row
  without a `site` key (used by `approve/__tests__`, `request-changes/__tests__`,
  `[id]/__tests__/patch.test.ts`) keep working unchanged — none of them assert on the exact
  `select` shape passed to `findFirst`.
- `app/(portal)/portal/articles/[id]/page.tsx` — already surfaces `payload.error` from a failed
  PATCH inline (`actionError`); verified the message renders as plain text with no truncation, so
  no client changes are required.
- New file `lib/articles/html-validation.ts` has no existing callers/tests.

## Files to Create
- `lib/articles/html-validation.ts` — `validateHtmlFragment(html): {valid:true} |
  {valid:false, message}`. Dependency-free tag-balance checker: handles void elements (br, img,
  hr, input, meta, link, source, wbr, embed, area, base, col, track), self-closing tags, HTML
  comments (ignored), attributes containing `>` inside quotes, and stray `<` in prose (plain
  text/markdown passes through untouched). Only flags structural breakage (unclosed/mismatched/
  dangling tags) — never style or semantic opinions.
- `lib/articles/__tests__/html-validation.test.ts` — unit tests.

## Files to Modify
- `lib/articles/portal-actions.ts` — extend `ActionableArticle` with `site_type: string | null`;
  extend `loadActionableArticle`'s select with `site: { select: { site_type: true } }` and flatten
  it onto the return value.
- `app/api/portal/articles/[id]/route.ts` PATCH — after the zod parse, decide `isWordPress`:
  if `article.site_type` is known, `=== 'wordpress'`; otherwise heuristic
  `body.trim().startsWith('<')`. When true, run `validateHtmlFragment(body)`; on `{valid:false}`
  throw `ApiError(message, 400)` before the `prisma.article.update` call. Empty body is exempt
  (heuristic naturally passes empty strings through as non-HTML, and an empty string is trivially
  well-formed anyway).

## Implementation Steps
1. Write `html-validation.ts` + its unit tests.
2. Extend `portal-actions.ts` loader (`site_type` passthrough).
3. Wire the check into the PATCH route.
4. Extend PATCH route tests for the new 400 case.

## Tests to Update (from Impact Analysis)
- None of the existing `approve`, `request-changes`, or `patch` tests assert on `findFirst`'s
  `select` argument, so no existing assertions change — only new tests are added.

## Tests to Write
- `html-validation.test.ts`: balanced tags, unbalanced/unclosed tag, mismatched nesting, dangling
  closing tag, void elements (with and without self-closing slash), attributes containing `>` in
  quotes, HTML comments ignored, plain markdown/text passes untouched, empty string valid.
- `patch.test.ts`: 400 with the friendly message when `site_type === 'wordpress'` and body is
  broken HTML; passes through (200) when HTML is well-formed; heuristic path (no site_type)
  rejects a body that looks like broken HTML; plain-text body is never validated as HTML.

## Verification Checklist
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test -- --run lib/articles/__tests__ app/api/portal/articles/[id]/__tests__
      app/api/portal/articles/__tests__` passes
