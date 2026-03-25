'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FileWarning, ExternalLink, XCircle, FileText, Video } from 'lucide-react';
import { useIncompleteMeetings, useUpdateMeeting } from '@/lib/hooks/use-meetings';
import { DashboardSection } from './dashboard-section';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/hooks/use-toast';
import type { MeetingWithRelations } from '@/types/entities';

function getMissingItems(meeting: MeetingWithRelations): string[] {
  const missing: string[] = [];
  if (!meeting.transcript_url && !meeting.transcript_not_available) {
    missing.push('transcript');
  }
  if (!meeting.recording_url && !meeting.recording_not_available) {
    missing.push('recording');
  }
  return missing;
}

export function IncompleteMeetings() {
  const router = useRouter();
  const { data, isLoading } = useIncompleteMeetings();
  const updateMeeting = useUpdateMeeting();

  const meetings = (data as { meetings?: MeetingWithRelations[] })?.meetings;

  // Don't show anything if no incomplete meetings or still loading
  if (isLoading || !meetings || meetings.length === 0) {
    return null;
  }

  const handleMarkNA = async (meetingId: string, field: 'transcript' | 'recording') => {
    const updateData = field === 'transcript'
      ? { transcript_not_available: true }
      : { recording_not_available: true };

    try {
      await updateMeeting.mutateAsync({ id: meetingId, data: updateData });
      showToast.success(`Marked ${field} as N/A`);
    } catch {
      // Error toast handled by the hook
    }
  };

  return (
    <DashboardSection
      title="Missing Meeting Items"
      icon={FileWarning}
      iconColor="text-orange-500"
      count={meetings.length}
      action={{ label: 'View All', href: '/meetings' }}
    >
      <div className="space-y-3">
        {meetings.map((meeting) => {
          const missing = getMissingItems(meeting);

          return (
            <div
              key={meeting.id}
              className="flex items-start gap-3 p-3 rounded-lg bg-surface border border-border-warm"
            >
              <FileWarning className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-main truncate">
                  {meeting.title}
                </div>
                <div className="text-xs text-text-sub">
                  {new Date(meeting.meeting_date).toLocaleDateString()}
                  {meeting.client?.name && ` \u2022 ${meeting.client.name}`}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {missing.map((item) => (
                    <span
                      key={item}
                      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-600"
                    >
                      {item === 'transcript' ? (
                        <FileText className="h-3 w-3" />
                      ) : (
                        <Video className="h-3 w-3" />
                      )}
                      {item}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push(`/meetings/${meeting.id}`)}
                  title="Open meeting"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
                {missing.map((item) => (
                  <Button
                    key={item}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleMarkNA(meeting.id, item as 'transcript' | 'recording')}
                    title={`Mark ${item} as N/A`}
                    disabled={updateMeeting.isPending}
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </DashboardSection>
  );
}
