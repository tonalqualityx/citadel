# Clarity Phase 3c — Fleet screen split

Mike's ruling: the Seeing Stone (`/oracle`) is the attention surface only. The worker sections move to their own screen.

Hard rules identical to prior phases (worktree only, baseline first — floor 1542 tests / 129 files, all gates executed, no push, registry untouched unless routes change, repo conventions).

## Changes

1. New page `/oracle/fleet` ("Fleet"): admin-only (same gating as /oracle), containing exactly the current In Motion and Docked sections (components reused as-is), plus the existing FleetTopbar/spawn button and filter/collapse controls if they were coupled to those sections. Machine-health/cron-error line stays on the Seeing Stone header AND appears here.
2. `/oracle` (Seeing Stone) drops In Motion and Docked entirely. Remaining: header (idea quick-add, week strip), Today, Needs Reshi. Legacy waiting cards STAY in Needs Reshi › Answer (they are attention items, not machinery). Empty-state logic updated.
3. Nav (Sidebar + MobileNav): Oracle group gets two children — "Seeing Stone" (`/oracle`, 🔮) and "Fleet" (`/oracle/fleet`, existing fleet-ish emoji or ⚙️/🛰 pick one theme-consistent). A small link/button on the Seeing Stone header to the Fleet screen ("N in motion · M docked" as the link text, count-only, quiet).
4. Update all affected tests + the e2e spec (Seeing Stone spec loses In Motion/Docked assertions, gains the count-link; new fleet-page e2e asserts the sections render there; regenerate screenshots incl. a new `desktop-1280-fleet.png`).

## Gates

Baseline, full suite green, build clean, e2e green, screenshots. Report: counts, gate results, screenshot paths, commits, deviations.
