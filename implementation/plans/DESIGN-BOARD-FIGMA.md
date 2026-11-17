# Feature: Figma link on the Board, Inspiration tab, design file over inspiration

Mike, 2026-11-17: "Yes, add the Figma link to the portal's board"; "And we should add a tab on the chat box for
inspiration sites"; "If there's a figma or other design file, the inspiration sites don't get used. If there isn't and
someone says build from inspiration it refers to them. Otherwise they're there for the designer to reference".

## Overview
- The Board tab holds the designer's own design files: Figma frames and uploads. She pastes a Figma link; each frame
  becomes a card with a picture she can mark up, and the frame's measured values (colours, type, spacing, radii, layout,
  component names) are stored on the card as data.
- A new Inspiration tab (right after Board) holds sites: Bast's picks, client-named sites and sites she adds.
- Rule: when the track has a design file, inspiration sites are not given to the chat worker or the builds. With no
  design file, the build gets only the inspiration sites the signed direction cites.
- No Prisma migration, no new route, no new job kind, no new dependency. Citadel never holds the Figma key.

## Contract (all four codebases build to this)

### Sources and roles
- `DesignReference.source` gains `designer_figma`.
- `role`: `design_file` for `designer_upload` and `designer_figma`; `inspiration` for every other source.
- A design file is usable when `decision !== 'no'` and (figma: `capture_status === 'captured'`; upload: at least one
  ready picture). `has_design_file` = at least one usable design file on the track.

### Figma link (Citadel, `lib/design/figma-link.ts`, pure)
- `isFigmaHost(url)`: host is exactly `figma.com` or `www.figma.com`.
- `parseFigmaLink(raw)` -> `{ file_key, node_id | null, canonical_url }`. https only; path
  `/(design|file|proto)/<key>` where key is 10 to 64 letters and digits; `node-id` accepted as `12-34` or `12:34`
  (digits only each side), stored as `12:34`. Canonical: `https://www.figma.com/design/<key>` plus `?node-id=12-34`
  when present. Every other query value and the fragment are dropped. A Figma host that does not parse (FigJam
  `/board/`, community, a bare home page) throws 400 `bad_figma_link`: "That Figma link does not point at a design
  file. In Figma, right-click a frame, choose Copy link, and paste that."

### Designer POST `/api/design/sessions/:id/references`
- URL body becomes `{ url, title?, expect?: 'figma' }` (still strict).
- Figma host: reference `source: 'designer_figma'`, `url: canonical_url`, `title: 'Figma design'`,
  `capture_status: 'queued'`, one `capture` job with payload `{ reference_id, url, figma: { file_key, node_id } }`.
- `expect: 'figma'` with a non-Figma URL: 400 `not_figma`: "That is not a Figma link. Sites go on the Inspiration tab."
- Duplicate check, per-minute cap and captures-in-flight cap treat `designer_url` and `designer_figma` alike. The
  40-per-track cap stays for `designer_url` only; `designer_figma` has its own cap of 200 per track.

### Runner POST `/api/design/runner/tracks/:id/references`
- `source` enum gains `designer_figma`. Such an item must carry a URL that `parseFigmaLink` accepts with a node id;
  it is stored canonical and its capture job payload carries `figma`. Anything else: 400.

### Runner PATCH `/api/design/runner/references/:id`
- New optional `title` (1 to 200). Allowed only on a `designer_figma` reference, else 400 `title_not_allowed`.
- `extracted` cap: 16 KB as today; 40 KB when the reference is `designer_figma`. Route body cap raised to 96 KB.

### `extracted` for a Figma frame (written by the runner; no text content, names only)
```
{ "schema": 1, "source": "figma",
  "figma": {
    "file_key", "file_name", "page", "node_id",
    "frame": { "name", "width", "height" },
    "colours": [{ "hex", "uses" }],                      // up to 24, solid fills and strokes
    "type_styles": [{ "family", "weight", "size", "line_height", "letter_spacing", "uses" }],   // up to 24
    "spacing": { "gaps": [{ "px", "uses" }], "paddings": [{ "px", "uses" }] },                  // up to 12 each
    "radii": [{ "px", "uses" }],                         // up to 8
    "components": ["name"],                              // up to 40
    "layout": { "name", "type", "w", "h", "dir", "gap", "pad": [t,r,b,l], "align", "fill", "children": [...] },
    "frames_total", "frames_imported"                    // only on the pasted card, when the link held several frames
  } }
```
No key may be one of `FORBIDDEN_PROJECTION_KEYS` (`lib/design/projections.ts`): `stripForbidden` would drop it.
Names are cut to 80 characters and limited to letters, digits, space and `. , & / ( ) + # ' _ -`.

### Designer view (`referenceView`)
- New `role` and `figma`. `figma` is null unless `extracted.source === 'figma'`; else
  `{ file_name, page, frame_name, width, height, frames_total, frames_imported }` (strings cut to 120, numbers or null).
  It must not carry all of `kind`, `content_type` and `id` (the worker view swap keys on those).

### Worker context `board` part
- `data = { has_design_file, references }`; each reference carries `role` and `figma` (and `extracted` as today).

### Runner track read (`include=references`)
- Each reference row keeps every key it has today and gains `role` and
  `design_assets: [{ id, kind, content_type, width, height, view }]` (design files only; `view` is `frame_fold`,
  `frame_full` or `upload`; raster pictures that are ready: the figma capture assets, a ready raster upload, or the
  render pictures of an upload). Empty array for inspiration.

## Files to Create
- [ ] `app/lib/design/figma-link.ts` - the parser above
- [ ] `app/lib/design/reference-role.ts` - `referenceRole(source)`, `isUsableDesignFile`, `hasDesignFile`
- [ ] `app/components/domain/design/board/AddFigma.tsx` - "Add a Figma link" field
- [ ] `app/components/domain/design/board/InspirationTab.tsx` - Add a site + inspiration cards
- [ ] `app/components/domain/design/board/ReferenceList.tsx` - the shared card list and Set aside section
- [ ] `app/components/domain/design/board/__tests__/inspiration-tab.test.tsx`
- [ ] `app/lib/design/__tests__/figma-link.test.ts`
- [ ] Runner: `figma_handler.py`, `figma_extract.py`, `figma_reencode.py`, `build_references.py`, `tests/test_figma_handler.py`, `tests/test_build_references.py`

## Files to Modify
- [ ] `app/lib/design/track-board.ts` - Figma branch in `addDesignerReference`, caps, `referenceView` role and figma
- [ ] `app/app/api/design/sessions/[id]/references/route.ts` - `expect`
- [ ] `app/lib/design/track-runner.ts` - `addReferences` figma items, `recordCapture` title and cap, track read mapping
- [ ] `app/app/api/design/runner/tracks/[id]/references/route.ts`, `app/app/api/design/runner/references/[id]/route.ts`
- [ ] `app/lib/design/worker-context.ts` - `has_design_file`
- [ ] `app/lib/api/registry/design.ts` - reference example, the four route entries
- [ ] `app/components/domain/design/Workspace.tsx`, `WorkspaceTabs.tsx` - `inspiration` tab and slot
- [ ] `app/components/domain/design/board/BoardTab.tsx`, `ReferenceCard.tsx`, `AddSite.tsx`, `UploadZone.tsx` (copy only)
- [ ] `app/lib/hooks/use-design-board.ts` - `role`, `figma`, `useAddFigma`
- [ ] Runner: `handler_registry.py` (dispatch), `portal_build.py` (reference selection, design pictures),
      `prompts/home-build.md`, `prompts/rest-build.md`, `tests/fake_runner_citadel.py`, `README.md`
- [ ] Daemon: `src/tools/design-context.ts`, `prompts/designer-worker-v2.md`, tests
- [ ] Wright: `lib/figma.py` (size caps, `get_me`), `lib/reference_clone_check.py` (+ test),
      `references/design-portal-workflow.md` (the "Figma import" line)

## Implementation Steps
1. Citadel server and registry (agent A).
2. Citadel UI (agent B), to the contract above, in parallel with A.
3. Runner and Wright lib (agent C), in a scratch copy; installed by the orchestrator after the gates.
4. Daemon (agent D), in a scratch copy; installed and restarted by the orchestrator when no session is mid-turn.
5. Orchestrator: gates, a real Figma run against a file the key can read, Opus review, commit, ship, install.

## Tests to Update (from Impact Analysis)
- [ ] `components/domain/design/__tests__/workspace.test.tsx:194-210` - tracked labels gain `Inspiration` after `Board`
- [ ] `components/domain/design/__tests__/workspace-tabs-track.test.tsx:14,28-35,64-69` - mock InspirationTab, slot keys string gains `inspiration`
- [ ] `components/domain/design/board/__tests__/board-tab.test.tsx` - site cards, yes and no, add a site, capture chips and markup cases move to the Inspiration test; Board keeps uploads and gains Figma cases
- [ ] `__tests__/e2e/design-v2-board.spec.ts` - seeded site cards are on Inspiration; add a site moves there; Board gains a Figma link case
- [ ] `__tests__/e2e/design-v2-brief.spec.ts:75-77` - add `Inspiration` to the tab loop
- [ ] `__tests__/e2e/fixtures/design-v2-fixture.ts:107,156` - `openDockTab` union, `ReferenceSeed.source` union, `extracted` and `upload_asset_ids` on the seed
- [ ] `app/api/design/sessions/__tests__/track-board.integration.test.ts:760-784` - caps count both designer link sources
- [ ] Runner `tests/test_home_build_handler.py`, `tests/test_rest_build_handler.py` - references given to the build follow the rule

## Tests to Write
- [ ] Figma link parser: hosts, canonical form, node id forms, look-alike hosts, FigJam refusal
- [ ] Designer POST: figma creation, job payload, duplicate, `not_figma`, `bad_figma_link`, role and figma in the view, forbidden keys
- [ ] Runner POST with `designer_figma`; PATCH `title`, 16 KB and 40 KB caps, strict body
- [ ] Runner track read: `role` and `design_assets`
- [ ] Worker context: `has_design_file`, role
- [ ] Board and Inspiration component tests; tab order; Playwright Board and Inspiration
- [ ] Runner: figma handler (one frame, a page of frames, not shared, no frames), extraction, re-encode under the upload limit, build reference selection
- [ ] Daemon: board block order, inspiration left out when a design file exists, pictures for design files
- [ ] Wright: clone check exempts `designer_figma`

## Verification Checklist
- [ ] `tsc`, vitest (zero new failures), lint delta, `next build` (the CIT6 gate script)
- [ ] The seven design Playwright specs
- [ ] Runner and daemon suites in the scratch copies, then again after install
- [ ] A real run of the Figma handler against a file the key can read: pictures under the upload limit, values present
- [ ] Opus review of the handler and the server changes
- [ ] Live build sha after deploy; a Figma link pasted on a live track ends as a captured card
