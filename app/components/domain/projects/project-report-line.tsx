'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

type ReportCadence = 'none' | 'weekly' | 'every_2_weeks' | 'monthly';
type ReportDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

interface EngagementBriefReport {
  report_cadence: ReportCadence;
  report_day: ReportDay | null;
  report_to: string[];
  next_report_on: string | null;
}

const DAY_NAMES: Record<ReportDay, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

/** "YYYY-MM-DD" read as a calendar day (no timezone shift), e.g. "Nov 20". */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function cadenceText(brief: EngagementBriefReport): string {
  const day = brief.report_day ? DAY_NAMES[brief.report_day] : null;
  if (brief.report_cadence === 'monthly') return day ? `monthly on the first ${day}` : 'monthly';
  if (brief.report_cadence === 'every_2_weeks') return day ? `every 2 weeks on ${day}` : 'every 2 weeks';
  return day ? `every ${day}` : 'every week';
}

function recipientText(to: string[]): string {
  if (to.length === 0) return "to the client's primary contact";
  const extra = to.length > 1 ? ` +${to.length - 1} more` : '';
  return `to ${to[0]}${extra}`;
}

/** Read-only line on the project header: when the client report goes out, next date and recipients. Hidden when there is no brief or no cadence. */
export function ProjectReportLine({ projectId }: { projectId: string }) {
  const { data } = useQuery({
    queryKey: ['project-report-line', projectId],
    queryFn: async () => {
      try {
        return await apiClient.get<EngagementBriefReport>(`/projects/${projectId}/engagement-brief`);
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
    retry: 0,
  });
  if (!data || data.report_cadence === 'none') return null;
  const next = data.next_report_on ? `next ${shortDate(data.next_report_on)}` : 'paused';
  return (
    <p className="min-w-0 break-words text-sm text-text-sub" data-testid="project-report-line">
      {`Client report: ${cadenceText(data)}, ${next}, ${recipientText(data.report_to)}`}
    </p>
  );
}
