# Feature: Accept Markdown for task descriptions (MD → BlockNote at the API)

Citadel task `6bea38ca-fdde-4656-8e6c-88fd12f7b9ec`.

## Overview
Let the task `description` (and `notes`) fields accept Markdown / plain strings and
convert them to BlockNote JSON blocks server-side, so agents and humans can author in
plain Markdown. Raw BlockNote arrays still accepted (back-compat). This removes the
class of bug where a plain string rendered BLANK (the read-only renderer feeds the value
straight into BlockNote as `initialContent`, which only accepts a block array).

## Approach decision
Pure, dependency-free converter rather than `@blocknote/server-util`:
- BlockNote's own markdown parser needs a DOM (prosemirror `DOMParser.parse`); the API
  route is Node. `server-util` (jsdom-backed) would be a new heavy dep bundled into a
  server route. **CI only runs `npm ci` + `npm run build` (no tests)** — so minimizing
  build/bundle risk matters, and a pure function is fully unit-testable.
- Output shape matches BlockNote docs already stored in Citadel:
  `{ id, type, props?, content }`, inline `{ type:'text', text, styles }` /
  `{ type:'link', href, content }`. `children` intentionally omitted (proven shape).
- Bounded Markdown subset (covers how descriptions are actually authored): headings
  (#–###), paragraphs, bullet/numbered lists, fenced code, inline bold/italic/code/
  strike/links. Anything else → plain paragraph text. Never returns empty for non-empty
  input → never renders blank.

## Files to Create
- [x] `app/lib/api/blocknote.ts` — `markdownToBlockNote`, `normalizeRichTextInput`, `serializeRichText`
- [x] `app/lib/api/__tests__/blocknote.test.ts` — unit tests for the converter

## Files to Modify
- [x] `app/app/api/tasks/route.ts` (CREATE) — description schema `z.string`→`z.any`; store via `serializeRichText`; same for notes
- [x] `app/app/api/tasks/[id]/route.ts` (PATCH) — description/notes stored via `serializeRichText`

## Tests to Update (from Impact Analysis)
- [x] `app/app/api/tasks/__tests__/route.test.ts` — the "all fields" create test asserts
  `description: 'Task description'` and `notes: 'Some notes'` are passed to `prisma.task.create`.
  After the change these are JSON-stringified BlockNote arrays; assert they parse to a
  paragraph block containing the text instead.

## Tests to Write
- [x] plain string → single paragraph block (never blank)
- [x] headings #/##/### (and clamp ####+ → level 3)
- [x] bullet + numbered lists
- [x] inline bold / italic / code / strike / links
- [x] raw BlockNote array passes through unchanged
- [x] JSON-stringified BlockNote array parses through
- [x] null / empty string → null
- [x] fenced code block → codeBlock
- [x] `serializeRichText` returns JSON string / null

## Verification Checklist
- [x] Type check clean (`npx tsc --noEmit`)
- [x] Full test suite passes (zero broken tests)
- [x] Production build succeeds (`npm run build`)
- [x] One reversible commit referencing the task
