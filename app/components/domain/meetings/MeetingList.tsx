'use client';

import * as React from 'react';
import { Calendar, AlertTriangle, Plus } from 'lucide-react';
import { useMeetings } from '@/lib/hooks/use-meetings';
import { MeetingPeekDrawer } from './MeetingPeekDrawer';
import { MeetingForm } from './MeetingForm';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@/components/ui/modal';
import type { MeetingWithRelations } from '@/types/entities';

interface MeetingListProps {
  clientId?: string;
  accordId?: string;
  projectId?: string;
  charterId?: string;
  showCreateButton?: boolean;
}

function isMissingItems(meeting: MeetingWithRelations): boolean {
  const meetingDate = new Date(meeting.meeting_date);
  if (meetingDate >= new Date()) return false;

  const missingTranscript = !meeting.transcript_url && !meeting.transcript_not_available;
  const missingRecording = !meeting.recording_url && !meeting.recording_not_available;

  return missingTranscript || missingRecording;
}

export function MeetingList({
  clientId,
  accordId,
  projectId,
  charterId,
  showCreateButton = true,
}: MeetingListProps) {
  const [peekMeetingId, setPeekMeetingId] = React.useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = React.useState(false);

  const { data, isLoading } = useMeetings({
    client_id: clientId,
    accord_id: accordId,
    limit: 100,
  });

  const meetings = React.useMemo(() => {
    if (!data?.meetings) return [];

    // If projectId or charterId filters are provided, filter client-side
    // since the API may not support these filters directly
    let filtered = data.meetings;

    if (projectId) {
      filtered = filtered.filter((m) =>
        m.meeting_projects?.some((mp) => mp.project_id === projectId)
      );
    }

    if (charterId) {
      filtered = filtered.filter((m) =>
        m.meeting_charters?.some((mc) => mc.charter_id === charterId)
      );
    }

    return filtered;
  }, [data, projectId, charterId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      {showCreateButton && (
        <div className="flex justify-end mb-4">
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Meeting
          </Button>
        </div>
      )}

      {meetings.length === 0 ? (
        <EmptyState
          icon={<Calendar className="h-10 w-10" />}
          title="No meetings yet"
          description="Create a meeting to track discussions and action items."
          action={
            showCreateButton ? (
              <Button onClick={() => setShowCreateModal(true)}>
                <Plus className="h-4 w-4 mr-2" />
                New Meeting
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-alt border-b border-border">
                <th className="text-left px-4 py-2 font-medium text-text-sub">Title</th>
                <th className="text-left px-4 py-2 font-medium text-text-sub">Client</th>
                <th className="text-left px-4 py-2 font-medium text-text-sub">Date</th>
                <th className="text-left px-4 py-2 font-medium text-text-sub">Attendees</th>
                <th className="w-10 px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {meetings.map((meeting) => (
                <tr
                  key={meeting.id}
                  onClick={() => setPeekMeetingId(meeting.id)}
                  className="border-b border-border last:border-b-0 hover:bg-surface-alt cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-text-main">{meeting.title}</span>
                  </td>
                  <td className="px-4 py-3 text-text-sub">
                    {meeting.client?.name || '--'}
                  </td>
                  <td className="px-4 py-3 text-text-sub">
                    {new Date(meeting.meeting_date).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    {meeting.attendees && meeting.attendees.length > 0 ? (
                      <div className="flex -space-x-1">
                        {meeting.attendees.slice(0, 5).map((attendee) => (
                          <Avatar
                            key={attendee.id}
                            name={attendee.user?.name || 'Unknown'}
                            size="xs"
                          />
                        ))}
                        {meeting.attendees.length > 5 && (
                          <span className="flex items-center justify-center h-5 w-5 rounded-full bg-surface-2 text-[10px] text-text-sub border border-surface">
                            +{meeting.attendees.length - 5}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-text-sub">--</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isMissingItems(meeting) && (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Peek Drawer */}
      <MeetingPeekDrawer
        meetingId={peekMeetingId}
        open={!!peekMeetingId}
        onOpenChange={(open) => {
          if (!open) setPeekMeetingId(null);
        }}
      />

      {/* Create Modal */}
      <Modal open={showCreateModal} onOpenChange={setShowCreateModal}>
        <ModalContent size="lg">
          <ModalHeader>
            <ModalTitle>New Meeting</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <MeetingForm
              onSuccess={() => setShowCreateModal(false)}
              onCancel={() => setShowCreateModal(false)}
              defaultClientId={clientId}
              defaultAccordId={accordId}
              defaultProjectId={projectId}
              defaultCharterId={charterId}
            />
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}
