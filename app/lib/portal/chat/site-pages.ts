/** Limits and text cleaning for the site page sync (phase C spec 3). */

export const MAX_PAGES = 300;
export const MAX_SECTIONS = 12;

/** Page text comes from the open web: flatten it to one plain line of at most `max` characters. */
export function cleanText(value: string, max: number): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
