import { describe, it, expect } from 'vitest';
import { OTHERS_TAB_LABEL, OTHERS_TAB_TITLE, pastDateDaysLabel } from '../others-copy';
import { EMPTY_TILE } from '../copy';
import { HOME_TILE_ORDER } from '../types';

const BANNED = /priority|\bP[1-5]\b|overdue|\blate\b|past due/i;

describe('the owner\'s tab name is the one place the word lives', () => {
  it('is his own words, 2026-11-13', () => {
    expect(OTHERS_TAB_LABEL).toBe('overdue by others');
    expect(OTHERS_TAB_TITLE).toBe('Overdue by others');
  });
  it('the tile id, the empty sentence and the row words carry no banned word', () => {
    expect(HOME_TILE_ORDER).toContain('past_date_others');
    expect(HOME_TILE_ORDER.some((id) => BANNED.test(id))).toBe(false);
    expect(EMPTY_TILE.past_date_others).toBe('Nobody else has anything past its date.');
    for (const s of [EMPTY_TILE.past_date_others, pastDateDaysLabel(1), pastDateDaysLabel(9)]) expect(s).not.toMatch(BANNED);
  });
});
