import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as React from 'react';

const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: m.get } }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectPlanLink } from '../project-plan-link';

const wrap = () => render(<QueryClientProvider client={new QueryClient()}><ProjectPlanLink projectId="p1" /></QueryClientProvider>);
beforeEach(() => m.get.mockReset());

describe('ProjectPlanLink', () => {
  it('links to the setup card Plan tab with the line count', async () => {
    m.get.mockResolvedValue({ href: '/tasks/t1?tab=plan', plan_lines: 12 });
    wrap();
    const a = await screen.findByTestId('project-plan-link');
    expect(a.getAttribute('href')).toBe('/tasks/t1?tab=plan');
    expect(a.textContent).toBe('Plan (12)');
  });
  it('shows nothing when the project has no plan or the person may not read it', async () => {
    m.get.mockImplementation(() => Promise.reject(new Error('404')));
    wrap();
    await waitFor(() => expect(m.get).toHaveBeenCalled());
    expect(screen.queryByTestId('project-plan-link')).toBeNull();
  });
});
