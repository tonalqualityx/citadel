# Clarity Phase 7 (P1) — Seeing Stone Reckoning: schema + API

## Overview

Phase 1 of 4 of "Seeing Stone Reckoning" (spec: `~/.claude/tools/oracle/clarity/
SEEING-STONE-RECKONING.md`, THE ANSWERED SPEC section — Mike-ruled 2026-07-27, binding).
Schema + API ONLY this phase — no UI components. Unifies the arc model as THE thread
object: arcs gain a real next_touch date, an Accord (pipeline) link, and a cover image
slot; the today-picks "lead" wiring moves off the wrong entity (Charter, a signed
contract) onto Accord (the actual pipeline record); emails attach directly to arcs;
Today picks can link to a synced calendar event; a new `/api/arcs/{id}/context` endpoint
gives a spawned Claude Code session the full arc briefing; waiting-on-me's counts stop
lying and the "plate rule" (quote/queue-status projects contribute zero) ships; a
completion-nudge hook fires on task/arc close so the client follow-up draft isn't lost to
memory; oracle/ingest hardens its arc_id passthrough.

## Files to Modify

- [ ] `prisma/schema.prisma` — Arc (next_touch, accord_id FK, cover_url), Task (cover_url),
      EmailAsk (arc_id FK), TodayPick (calendar_event_id, accord_id FK)
- [ ] `lib/today-picks.ts` — REF_FIELD_BY_TYPE lead -> accord_id
- [ ] `app/api/today/route.ts` — POST validates accord_id against prisma.accord instead of
      charter; back-compat read path for legacy charter_id picks
- [ ] `lib/services/today-picks-shape.ts` / `app/api/today/[id]/route.ts` — accord summary
      shaping alongside legacy charter shaping
- [ ] `app/api/today/[id]/route.ts` — PATCH accepts `date` (currently silently ignored)
      and calendar_event_id set/clear
- [ ] `app/api/arcs/[id]/route.ts` — PATCH accepts next_touch/accord_id/cover_url; GET
      includes accord summary, attached email_asks, today_picks
- [ ] `app/api/waiting-on-me/route.ts` — meta.counts gains intake+crisis (true total);
      do-queue stable cross-bucket P1/P2 float; plate rule excludes quote/queue project
      tasks from the do queue and counts
- [ ] `app/api/tasks/[id]/route.ts` — PATCH status-only branch: on transition to done with
      an attached email_ask (direct or via arc), include completion_nudge in the response
- [ ] `app/api/email-asks/[id]/create-task/route.ts` — stamp ask.arc_id alongside
      task.arc_id when create-task resolves an arc
- [ ] `app/api/oracle/ingest/route.ts` — validate snapshot arc_id against prisma.arc;
      store null + warning on miss instead of failing the whole ingest call
- [ ] `lib/api/registry/clarity.ts`, `lib/api/registry/tasks.ts`, `lib/api/registry/
      oracle.ts` — registry entries for every touched/new endpoint

## Files to Create

- [ ] `app/api/arcs/[id]/context/route.ts` — GET session-briefing endpoint
- [ ] `app/api/email-asks/[id]/attach/route.ts` — POST {arc_id|task_id}, idempotent,
      sets state=handled

## Tests to Update

- [ ] `app/api/today/__tests__/route.test.ts` — lead item_type now validates against
      prisma.accord, not prisma.charter
- [ ] `app/api/today/[id]/__tests__/route.test.ts` — date + calendar_event_id PATCH cases
- [ ] `app/api/arcs/[id]/__tests__/route.test.ts` — next_touch/accord_id/cover_url PATCH
      cases; GET accord/email_asks/today_picks inclusion
- [ ] `app/api/waiting-on-me/__tests__/route.test.ts` — meta.counts total with
      intake+crisis; plate-rule exclusion; cross-bucket priority float ordering
- [ ] `app/api/email-asks/[id]/create-task/__tests__/route.test.ts` — ask.arc_id stamped
      when an arc is resolved

## Tests to Write

- [ ] `app/api/arcs/[id]/context/__tests__/route.test.ts`
- [ ] `app/api/email-asks/[id]/attach/__tests__/route.test.ts`
- [ ] task-completion-nudge cases in tasks/[id] tests
- [ ] oracle/ingest arc_id hardening case

## Verification Checklist

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `npm run test:run`
- [ ] `npx playwright test` (run if the environment allows; report explicitly if not)
- [ ] One commit per numbered feature in the dispatch spec, gates green before each push
