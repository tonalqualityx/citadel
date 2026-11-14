import { describe, it, expect } from 'vitest';
import fixture from './fixtures/report-due-cases.json';
import { computeReportDue, nextReportOn, reportDue, type ReportDueInput } from '../report-cadence';

describe('report cadence fixture', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(computeReportDue(c.input as ReportDueInput)).toEqual(c.expected);
    });
  }
});

describe('brief wrappers', () => {
  const brief = { report_cadence: 'weekly', report_day: 'fri', last_report_at: new Date('2026-11-13T12:30:00Z'), owner_mode: 'dry' };
  it('nextReportOn and reportDue agree with the pure function', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    expect(nextReportOn(brief, { status: 'in_progress' }, now)).toBe('2026-11-20');
    expect(reportDue(brief, { status: 'in_progress' }, now)).toBe(true);
    expect(reportDue(brief, { status: 'suspended' }, now)).toBe(false);
  });
  it('anchors a first report on the source time, not the last brief update', () => {
    const b = { ...brief, last_report_at: null, updated_at: new Date('2026-11-19T10:00:00Z'), report_source: { kind: 'mike', label: 'x', at: '2026-11-14T15:00:00Z' } };
    expect(nextReportOn(b, { status: 'ready' }, new Date('2026-11-15T00:00:00Z'))).toBe('2026-11-20');
  });
});
