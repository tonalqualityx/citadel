import { describe, it, expect } from 'vitest';
import { TRACK_STAGES, TRACK_TRANSITIONS, assertMove, canMove } from '../track-stage';
import { ADOPT_KINDS, TASK_JOB_KINDS } from '../track-core';
import { adoptResultSchema, isFinishGreen, jobBranchRe } from '../track-adopt';
import { briefBodySchema } from '../brief-schema';
import { newSlug } from '../track-runner';

describe('stage transition table (SPEC 2.5)', () => {
  it('has exactly the legal moves', () => {
    const moves = TRACK_STAGES.flatMap((from) => Object.entries(TRACK_TRANSITIONS[from]).map(([to, trigger]) => `${from} -> ${to} (${trigger})`));
    expect(moves).toEqual([
      'research -> art_direction (brief_and_outline)',
      'art_direction -> home_build (direction_signed)',
      'home_build -> refine (home_build_adopted)',
      'home_build -> home_build (direction_rebuild)',
      'refine -> rest_build (home_ready)',
      'refine -> home_build (direction_rebuild)',
      'rest_build -> review (rest_build_adopted)',
      'review -> done (finish_green)',
      'review -> home_build (direction_rebuild)',
    ]);
  });

  it('refuses everything else, and cancelled and done are final', () => {
    const legal = new Set(TRACK_STAGES.flatMap((f) => Object.keys(TRACK_TRANSITIONS[f]).map((t) => `${f}>${t}`)));
    let refused = 0;
    for (const from of TRACK_STAGES) {
      for (const to of TRACK_STAGES) {
        if (legal.has(`${from}>${to}`)) { expect(canMove(from, to)).toBe(true); continue; }
        expect(canMove(from, to), `${from} -> ${to}`).toBe(false);
        refused++;
      }
    }
    expect(refused).toBe(64 - legal.size);
    expect(TRACK_TRANSITIONS.done).toEqual({});
    expect(TRACK_TRANSITIONS.cancelled).toEqual({});
  });

  it('a legal move with the wrong trigger is a 409 illegal_transition', () => {
    expect(() => assertMove('refine', 'rest_build', 'home_ready')).not.toThrow();
    expect(() => assertMove('refine', 'rest_build', 'finish_green')).toThrow(expect.objectContaining({ statusCode: 409, code: 'illegal_transition' }));
    expect(() => assertMove('research', 'done', 'finish_green')).toThrow(expect.objectContaining({ code: 'illegal_transition' }));
  });
});

describe('job kind sets', () => {
  it('adopting kinds are the six of SPEC 6.1a; recipe-task kinds are the six with a design-job tag', () => {
    expect([...ADOPT_KINDS].sort()).toEqual(['bulk_import', 'fact_fix', 'home_build', 'module', 'rest_build', 'wireframe']);
    expect([...TASK_JOB_KINDS].sort()).toEqual(['home_build', 'launch_readiness', 'provision', 'research', 'rest_build', 'wireframe']);
  });
});

describe('adopt helpers', () => {
  it('the job branch pattern is bound to the track slug and the job number', () => {
    const slug = newSlug();
    expect(slug).toMatch(/^[a-z2-7]{16}$/);
    const re = jobBranchRe(slug);
    expect(re.test(`design/t-${slug}-job-1`)).toBe(true);
    expect(re.test(`design/t-${slug}-job-1234`)).toBe(true);
    expect(re.test(`design/t-${slug}-job-12345`)).toBe(false);
    expect(re.test(`design/t-${slug}-job-`)).toBe(false);
    expect(re.test(`design/t-${slug}`)).toBe(false);
    expect(re.test(`design/t-${slug.replace(/^./, slug[0] === 'a' ? 'b' : 'a')}-job-1`)).toBe(false);
    expect(re.test(`design/${slug}-job-1`)).toBe(false);
    expect(re.test(`x/design/t-${slug}-job-1`)).toBe(false);
  });
  it('slugs are random, lowercase base32', () => {
    const set = new Set(Array.from({ length: 50 }, newSlug));
    expect(set.size).toBe(50);
  });
  it('adopt result: needs a head sha and an https preview url; pages default to none', () => {
    expect(adoptResultSchema.safeParse({ head_sha: 'a'.repeat(40), preview_url: 'https://x.pages.dev', pages: [{ path: '/' }] }).success).toBe(true);
    expect(adoptResultSchema.parse({ head_sha: 'abc1234', preview_url: 'https://x.pages.dev' }).pages).toEqual([]);
    for (const bad of [{ preview_url: 'https://x.pages.dev' }, { head_sha: 'zzzzzzz', preview_url: 'https://x.pages.dev' }, { head_sha: 'abc1234', preview_url: 'http://x.dev' }, { head_sha: 'abc1234', preview_url: 'https://x.dev', pages: [{ path: 'no-slash' }] }]) {
      expect(adoptResultSchema.safeParse(bad).success).toBe(false);
    }
  });
  it('finish is green only when every result is ok (or green: true)', () => {
    expect(isFinishGreen({ green: true })).toBe(true);
    expect(isFinishGreen({ green: false, results: [{ ok: true }] })).toBe(false);
    expect(isFinishGreen({ results: [{ ok: true }, { ok: true }] })).toBe(true);
    expect(isFinishGreen({ results: [{ ok: true }, { ok: false }] })).toBe(false);
    expect(isFinishGreen({ results: [] })).toBe(false);
    expect(isFinishGreen({})).toBe(false);
    expect(isFinishGreen(null)).toBe(false);
  });
});

describe('brief schema (SPEC 4.1)', () => {
  const ok = { version: 1, client: 'C', one_line: 'x', sections: [{ id: 'brand', title: 'Brand', cards: [{ id: 'b1', headline: 'h', summary: 'one two three', confidence: 'confirmed' }] }] };
  it('accepts a minimal brief and refuses over-long or unknown content', () => {
    expect(briefBodySchema.safeParse(ok).success).toBe(true);
    expect(briefBodySchema.safeParse({ ...ok, one_line: 'x'.repeat(161) }).success).toBe(false);
    const card = (over: object) => ({ ...ok, sections: [{ ...ok.sections[0], cards: [{ ...ok.sections[0].cards[0], ...over }] }] });
    expect(briefBodySchema.safeParse(card({ headline: 'h'.repeat(81) })).success).toBe(false);
    expect(briefBodySchema.safeParse(card({ summary: Array(61).fill('w').join(' ') })).success).toBe(false);
    expect(briefBodySchema.safeParse(card({ summary: Array(60).fill('w').join(' ') })).success).toBe(true);
    expect(briefBodySchema.safeParse(card({ image_asset_ids: Array(4).fill('3f2b8c1e-0000-4000-8000-000000000001') })).success).toBe(false);
    expect(briefBodySchema.safeParse(card({ confidence: 'sure' })).success).toBe(false);
    expect(briefBodySchema.safeParse(card({ sources: [{ kind: 'url', url: 'http://x.test', accessed: '2026-11-10' }] })).success).toBe(false);
    expect(briefBodySchema.safeParse({ ...ok, sections: [ok.sections[0], ok.sections[0]] }).success).toBe(false);
  });
});
