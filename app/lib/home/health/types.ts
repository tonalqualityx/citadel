/**
 * GET /api/home's `health` field (task 183ec7a8): the six health tiles in one row above the first list, option A of the health view report
 * that Mike tapped on 2026-11-26 ("A: six tiles in one row on the first screen"). Snake_case like every home payload.
 * No score or priority number ever leaves the server: a tile carries its words, its number as text, and its state.
 */

export type HealthTileId = 'ready_to_invoice' | 'owed_to_us' | 'sales' | 'projects' | 'clients' | 'agents';

/**
 * normal: near its usual. look: it moved the bad way from its usual (or a site is down). building: fewer than 7 days of readings, so there
 * is no usual to compare with yet (never shown as Normal). unknown: the source could not be read.
 */
export type HealthState = 'normal' | 'look' | 'building' | 'unknown';

export interface HealthTile {
  id: HealthTileId;
  /** "Ready to invoice" */
  label: string;
  /** The one number, already written: "$4,200", "2 out", "21 · 7", "All up", "41". "Not available" when unreadable. */
  figure: string;
  /** The one line under it: "9 clients", "3 invoices late", "moving · stuck". */
  line: string;
  state: HealthState;
  /** "Normal", "Look at this", "No usual yet" or "Could not read". */
  state_label: string;
  /** The comparison with its own 12 week average: "Usual $3,900", or "Building its 12 week average (3 days so far)". */
  usual: string;
  /** How fresh the number is: "Live", "Copied 10:07 AM" (the last QuickBooks copy in his zone; "Copied Nov 26, 10:07 AM" on an earlier day), or both for Ready to invoice. */
  fresh: string;
  /** The detail for the side panel: a few short lines, each one fact. */
  detail: string[];
  /** Where the full picture is (an in-app path), or null. */
  href: string | null;
  /** The label for that link. */
  href_label: string | null;
}

export interface HomeHealth {
  /** "Five of six are normal. One needs a look." */
  summary: string;
  tiles: HealthTile[];
  generated_at: string;
}
