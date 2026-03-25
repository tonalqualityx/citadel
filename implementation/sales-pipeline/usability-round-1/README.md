# Usability Round 1 — Sales Pipeline Fixes

## Scope

This directory contains planning documents for usability fixes and enhancements to the existing Parley (Sales Pipeline) implementation. These are **independent of Phases 7-9** (QuickBooks, Vacation Mode, Analytics) in the original build plan and should be completed first.

## Documents

| Document | Contents |
|----------|----------|
| `01-meetings-entity.md` | Meetings as a first-class data type with associations |
| `02-accord-detail-rework.md` | Tab fixes, contract viewer, legacy field removal, tasks tab |
| `03-kanban-and-navigation.md` | Pipeline kanban cleanup, MSA/automation relocation, all-accords view |
| `04-ware-and-charter-fixes.md` | Ware detail screens, BlockNote everywhere, Charter UUID fix |
| `orchestration.md` | Instructions for the orchestrating agent |

## Priority Order

1. Meetings entity (01) — new data model, touches Accord detail
2. Accord detail rework (02) — depends on meetings entity existing
3. Kanban and navigation (03) — independent, can parallel with 02
4. Ware and charter fixes (04) — independent, can parallel with 02/03

## Important

- Do NOT begin Phases 7, 8, or 9 from the parent directory's `03-phased-build-plan.md`
- These usability fixes should be completed and verified first
- All existing tests must continue to pass at every step
