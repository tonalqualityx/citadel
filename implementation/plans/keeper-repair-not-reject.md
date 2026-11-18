# Feature: Keeper repairs card text instead of rejecting it

## Overview
Owner, 2026-11-18: "On the 'done when' rule - let's go ahead and fix that so it stops rejecting things." `saveSummaries` (lib/home/keeper/summaries.ts) used to refuse a whole card when its summary or any checklist line had a dash, "priority"/"overdue", too many words, or too many lines. Now it repairs, re-checks, and drops only what cannot be repaired.

## Impact analysis (by reading)
- Callers: `app/api/bast-chat/worker/home-keeper/summaries/route.ts` (POST) and `lib/home/__tests__/slice2b.integration.test.ts`. `textRefusal` stays exported with the same behavior except `--` no longer matches a flag like `--force` (only `word--word` or a spaced run).
- Result type `SummarySaveResult` gains `repaired`, `dropped_lines`, `repairs`; the route test mock and the API registry entry are updated.
- NOT in this repo: the machine side `~/.claude/tools/home-keeper/summarize.py` validates the model's reply (dashes, banned words, 14 words per line, 6 lines) BEFORE posting and logs "failed validation" as `invalid`. The server never saw those cards (`refused: 0` in every nightly log). Flagged in the report, not changed here.

## Files to Modify
- [x] `lib/home/keeper/summaries.ts` - repairText, prepareItem, counts in result
- [x] `app/api/bast-chat/worker/home-keeper/summaries/route.ts` - doc comment
- [x] `lib/api/registry/bast-chat.ts` - response shape and notes
## Tests to Update
- [x] `lib/home/__tests__/slice2b.integration.test.ts` - dash and banned inputs now repair; use inputs that still refuse (empty, banned-only). Needs a local DB, not run here.
- [x] `app/api/bast-chat/worker/home-keeper/summaries/__tests__/route.test.ts` - mock result shape
## Tests to Create
- [x] `lib/home/keeper/__tests__/summaries.test.ts` - repairText and prepareItem cases

## Repair order
dashes (comma, or full stop when a full sentence follows; hyphen in a word and `--flag` untouched) -> banned words (swap table; else drop that sentence of a summary, or that checklist line) -> trim at sentence, then clause boundary (none fits: refuse/drop) -> re-check. Empty summary still refuses. More than 8 checklist lines keeps the first 8.
