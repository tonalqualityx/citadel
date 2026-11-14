import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: m.get } }));

import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectReportLine } from '../project-report-line';

const wrap = () => render(<QueryClientProvider client={new QueryClient()}><ProjectReportLine projectId="p1" /></QueryClientProvider>);
const brief = (over: Record<string, unknown>) => ({
  report_cadence: 'weekly', report_day: 'fri', report_to: ['jane@client.com'], next_report_on: '2026-11-20', ...over,
});
beforeEach(() => { cleanup(); m.get.mockReset(); });

describe('ProjectReportLine', () => {
  it('shows nothing when the report cadence is none', async () => {
    m.get.mockResolvedValue(brief({ report_cadence: 'none', report_day: null, report_to: [], next_report_on: null }));
    wrap();
    await waitFor(() => expect(m.get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('project-report-line')).toBeNull();
  });
  it('shows nothing when the brief request 404s', async () => {
    m.get.mockImplementation(async () => { throw new Error('404'); });
    wrap();
    await waitFor(() => expect(m.get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('project-report-line')).toBeNull();
  });
  it('reads the weekly Friday report with its next date and recipient', async () => {
    m.get.mockResolvedValue(brief({}));
    wrap();
    const line = await screen.findByTestId('project-report-line');
    expect(m.get).toHaveBeenCalledWith('/projects/p1/engagement-brief');
    expect(line.textContent).toBe('Client report: every Friday, next Nov 20, to jane@client.com');
  });
  it('falls back to the primary contact when there are no recipients', async () => {
    m.get.mockResolvedValue(brief({ report_to: [] }));
    wrap();
    const line = await screen.findByTestId('project-report-line');
    expect(line.textContent).toBe("Client report: every Friday, next Nov 20, to the client's primary contact");
  });
  it('shows the first recipient and a count of the rest', async () => {
    m.get.mockResolvedValue(brief({ report_to: ['jane@client.com', 'bob@client.com', 'ann@client.com'] }));
    wrap();
    const line = await screen.findByTestId('project-report-line');
    expect(line.textContent).toBe('Client report: every Friday, next Nov 20, to jane@client.com +2 more');
  });
  it('shows paused in place of the next date when none is scheduled', async () => {
    m.get.mockResolvedValue(brief({ next_report_on: null }));
    wrap();
    const line = await screen.findByTestId('project-report-line');
    expect(line.textContent).toBe('Client report: every Friday, paused, to jane@client.com');
  });
});
