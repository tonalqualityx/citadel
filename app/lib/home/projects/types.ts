/**
 * Home screen Slice 8a: the project drawer on his screen. Shared shapes for the route, the
 * hook and the drawer. Nothing here carries a score, a class or a percent: the browser gets
 * his items (HomeItem), a plain "where" line for each, and the waits others hold.
 */

import type { HomeItem, HomeRef } from '../types';

/** One of his items in the project, and where it sits on his screen in words ("Needs you now", "Back Thursday, November 12"). */
export interface HomeProjectItem {
  item: HomeItem;
  where: string;
}

/** An open wait on the project that someone else holds ("Andy (client)", a teammate, a function). */
export interface HomeProjectWait {
  who: string;
  /** ISO. */
  since: string;
  title: string;
}

/** GET /api/home/projects/[id]. */
export interface HomeProjectResponse {
  project: { id: string; name: string; client: HomeRef | null };
  items: HomeProjectItem[];
  waits: HomeProjectWait[];
}

/** The part of a Projects card (GET /api/oracle/projects, already loaded for the tile) that the status reads. */
export interface ProjectCardLike {
  blockers: Array<{
    kind: string;
    owner: { name: string; is_mike: boolean };
    /** ISO. */
    since: string;
  }>;
  next_step: {
    text: string;
    owner: { id: string; name: string } | null;
    owner_label: string | null;
    source: 'graph' | 'bast' | 'mike' | 'none';
    /** ISO or null. */
    at: string | null;
  };
  last_movement: { at: string; who: string; what: string } | null;
  days_quiet: number | null;
  stale: boolean;
  linked_emails: Array<{
    from: string;
    subject: string;
    gist: string | null;
    received_at: string;
    deep_link: string;
  }>;
}

export interface StatusInput {
  now: Date;
  timeZone: string;
  /** The signed-in owner (HomeResponse.user_id), to tell whose next step it is. */
  userId: string;
  /** How many of his items here are in Needs you now. */
  needsNow: number;
  /** The Projects card, or null when the project is not in that list. */
  card: Pick<ProjectCardLike, 'blockers' | 'next_step' | 'last_movement' | 'stale'> | null;
  waits: HomeProjectWait[];
}
