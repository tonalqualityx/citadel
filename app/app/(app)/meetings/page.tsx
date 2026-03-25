'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useIncompleteMeetings } from '@/lib/hooks/use-meetings';
import { MeetingList } from '@/components/domain/meetings/MeetingList';
import { useTerminology } from '@/lib/hooks/use-terminology';

export default function MeetingsPage() {
  const { t } = useTerminology();
  const { data: incompleteData } = useIncompleteMeetings();

  const incompleteCount = Array.isArray(incompleteData)
    ? incompleteData.length
    : (incompleteData as { meetings?: unknown[] })?.meetings?.length ?? 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-text-main">
          {t('meetings')}
        </h1>
        <p className="text-text-sub">Track client meetings, notes, and follow-ups</p>
      </div>

      {/* Incomplete alert banner */}
      {incompleteCount > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">
            {incompleteCount} {incompleteCount === 1 ? 'meeting is' : 'meetings are'} missing transcript or recording
          </span>
        </div>
      )}

      {/* Meeting list */}
      <MeetingList showCreateButton={true} />
    </div>
  );
}
