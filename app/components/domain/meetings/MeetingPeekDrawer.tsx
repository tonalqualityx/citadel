'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Calendar,
  ExternalLink,
  Link2,
  Plus,
  Trash2,
  Users,
  Video,
  FileText,
  Building2,
} from 'lucide-react';
import {
  useMeeting,
  useUpdateMeeting,
  useAddMeetingAttendee,
  useRemoveMeetingAttendee,
  useLinkMeetingAccord,
  useUnlinkMeetingAccord,
  useLinkMeetingProject,
  useUnlinkMeetingProject,
  useLinkMeetingCharter,
  useUnlinkMeetingCharter,
} from '@/lib/hooks/use-meetings';
import { useTerminology } from '@/lib/hooks/use-terminology';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
  DrawerCloseButton,
} from '@/components/ui/drawer';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip } from '@/components/ui/tooltip';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { InlineUserSelect } from '@/components/ui/user-select';
import { getTaskStatusLabel, getTaskStatusVariant } from '@/lib/calculations/status';

// ============================================
// INLINE EDITABLE TEXT COMPONENT
// ============================================

interface InlineTextProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

function InlineText({
  value,
  onChange,
  className = '',
  placeholder = 'Click to edit...',
}: InlineTextProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  const handleSave = () => {
    if (draft.trim() && draft.trim() !== value) {
      onChange(draft.trim());
    } else {
      setDraft(value);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setDraft(value);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className={`bg-transparent border-b-2 border-primary outline-none w-full ${className}`}
      />
    );
  }

  return (
    <span
      onClick={() => {
        setDraft(value);
        setIsEditing(true);
      }}
      className={`cursor-pointer hover:bg-surface-alt px-1 -mx-1 rounded transition-colors ${className}`}
    >
      {value || <span className="text-text-sub italic">{placeholder}</span>}
    </span>
  );
}

// ============================================
// INLINE EDITABLE URL COMPONENT
// ============================================

interface InlineUrlProps {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  label: string;
}

function InlineUrl({ value, onChange, placeholder = 'Add URL...', label }: InlineUrlProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value || '');
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  React.useEffect(() => {
    setDraft(value || '');
  }, [value]);

  const handleSave = () => {
    const trimmed = draft.trim();
    if (trimmed !== (value || '')) {
      onChange(trimmed || null);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setDraft(value || '');
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="url"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="bg-transparent border-b-2 border-primary outline-none w-full text-sm text-text-main"
      />
    );
  }

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline truncate flex-1"
        >
          {value}
        </a>
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="text-text-sub hover:text-text-main"
        >
          <FileText className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className="text-sm text-text-sub hover:text-text-main italic"
    >
      {placeholder}
    </button>
  );
}

// ============================================
// MEETING PEEK DRAWER
// ============================================

interface MeetingPeekDrawerProps {
  meetingId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MeetingPeekDrawer({ meetingId, open, onOpenChange }: MeetingPeekDrawerProps) {
  const { t } = useTerminology();

  const { data: meeting, isLoading } = useMeeting(meetingId);
  const updateMeeting = useUpdateMeeting();
  const addAttendee = useAddMeetingAttendee();
  const removeAttendee = useRemoveMeetingAttendee();
  const linkAccord = useLinkMeetingAccord();
  const unlinkAccord = useUnlinkMeetingAccord();
  const linkProject = useLinkMeetingProject();
  const unlinkProject = useUnlinkMeetingProject();
  const linkCharter = useLinkMeetingCharter();
  const unlinkCharter = useUnlinkMeetingCharter();

  const saveImmediate = React.useCallback(
    (updates: Record<string, unknown>) => {
      if (!meetingId) return;
      updateMeeting.mutate({ id: meetingId, data: updates as any });
    },
    [updateMeeting, meetingId]
  );

  const handleAddAttendee = React.useCallback(
    (userId: string | null) => {
      if (!meetingId || !userId) return;
      // Check if already an attendee
      if (meeting?.attendees?.some((a) => a.user_id === userId)) return;
      addAttendee.mutate({ meetingId, user_id: userId });
    },
    [meetingId, meeting, addAttendee]
  );

  const handleRemoveAttendee = React.useCallback(
    (attendeeId: string) => {
      if (!meetingId) return;
      removeAttendee.mutate({ meetingId, attendeeId });
    },
    [meetingId, removeAttendee]
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" size="xl">
        <DrawerHeader>
          <DrawerTitle className="flex-1 pr-8">
            {isLoading ? (
              'Loading...'
            ) : meeting ? (
              <InlineText
                value={meeting.title}
                onChange={(title) => saveImmediate({ title })}
                className="text-lg font-semibold"
                placeholder="Enter meeting title..."
              />
            ) : (
              'Meeting'
            )}
          </DrawerTitle>
          <DrawerCloseButton />
        </DrawerHeader>
        <DrawerBody>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : meeting ? (
            <div className="space-y-5">
              {/* Client & Date */}
              <div className="flex items-center gap-4 text-sm flex-wrap">
                <div className="flex items-center gap-1">
                  <Building2 className="h-4 w-4 text-text-sub" />
                  {meeting.client ? (
                    <Link
                      href={`/clients/${meeting.client.id}`}
                      className="text-text-sub hover:text-primary"
                    >
                      {meeting.client.name}
                    </Link>
                  ) : (
                    <span className="text-text-sub italic">No client</span>
                  )}
                </div>
                <Tooltip content="Meeting Date">
                  <div className="flex items-center gap-1">
                    <Calendar
                      className="h-4 w-4 text-amber-500 cursor-pointer hover:text-amber-400"
                      onClick={() => {
                        const input = document.getElementById(
                          'peek-meeting-date'
                        ) as HTMLInputElement;
                        input?.showPicker?.();
                      }}
                    />
                    <input
                      id="peek-meeting-date"
                      type="date"
                      value={
                        meeting.meeting_date
                          ? meeting.meeting_date.split('T')[0]
                          : ''
                      }
                      onChange={(e) => {
                        const dateStr = e.target.value;
                        const isoValue = dateStr
                          ? new Date(dateStr + 'T00:00:00.000Z').toISOString()
                          : null;
                        if (isoValue) saveImmediate({ meeting_date: isoValue });
                      }}
                      className="bg-transparent text-sm text-text-main border-none p-0 focus:outline-none focus:ring-0 w-28 [&::-webkit-calendar-picker-indicator]:hidden"
                    />
                  </div>
                </Tooltip>
              </div>

              {/* Team Attendees */}
              <div>
                <h4 className="text-sm font-medium text-text-main mb-2 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Team Attendees
                </h4>
                <div className="space-y-2">
                  {meeting.attendees && meeting.attendees.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {meeting.attendees.map((attendee) => (
                        <div
                          key={attendee.id}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-surface-alt border border-border text-sm"
                        >
                          <Avatar
                            name={attendee.user?.name || 'Unknown'}
                            size="xs"
                          />
                          <span className="text-text-main">
                            {attendee.user?.name || 'Unknown'}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveAttendee(attendee.id)}
                            className="text-text-sub hover:text-red-500 ml-0.5"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-text-sub italic">No attendees</p>
                  )}
                  <div className="flex items-center gap-2">
                    <Plus className="h-4 w-4 text-text-sub" />
                    <InlineUserSelect
                      value={null}
                      onChange={handleAddAttendee}
                      placeholder="Add attendee..."
                    />
                  </div>
                </div>
              </div>

              {/* Client Attendees */}
              <div>
                <h4 className="text-sm font-medium text-text-main mb-2">
                  Client Attendees
                </h4>
                <InlineText
                  value={meeting.client_attendees || ''}
                  onChange={(client_attendees) =>
                    saveImmediate({ client_attendees })
                  }
                  className="text-sm"
                  placeholder="Enter client attendee names..."
                />
              </div>

              {/* Associations */}
              <div>
                <h4 className="text-sm font-medium text-text-main mb-2 flex items-center gap-2">
                  <Link2 className="h-4 w-4" />
                  Associations
                </h4>
                <div className="space-y-2">
                  {/* Accords */}
                  {meeting.meeting_accords && meeting.meeting_accords.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {meeting.meeting_accords.map((ma) => (
                        <div key={ma.id} className="flex items-center gap-1">
                          <Link href={`/deals/${ma.accord_id}`}>
                            <Badge variant="default" className="cursor-pointer">
                              {t('deal')}: {ma.accord?.name || 'Unknown'}
                            </Badge>
                          </Link>
                          <button
                            type="button"
                            onClick={() =>
                              unlinkAccord.mutate({
                                meetingId: meeting.id,
                                accordId: ma.accord_id,
                              })
                            }
                            className="text-text-sub hover:text-red-500"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Projects */}
                  {meeting.meeting_projects && meeting.meeting_projects.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {meeting.meeting_projects.map((mp) => (
                        <div key={mp.id} className="flex items-center gap-1">
                          <Link href={`/projects/${mp.project_id}`}>
                            <Badge variant="info" className="cursor-pointer">
                              {t('project')}: {mp.project?.name || 'Unknown'}
                            </Badge>
                          </Link>
                          <button
                            type="button"
                            onClick={() =>
                              unlinkProject.mutate({
                                meetingId: meeting.id,
                                projectId: mp.project_id,
                              })
                            }
                            className="text-text-sub hover:text-red-500"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Charters */}
                  {meeting.meeting_charters && meeting.meeting_charters.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {meeting.meeting_charters.map((mc) => (
                        <div key={mc.id} className="flex items-center gap-1">
                          <Link href={`/charters/${mc.charter_id}`}>
                            <Badge variant="purple" className="cursor-pointer">
                              Charter: {mc.charter?.name || 'Unknown'}
                            </Badge>
                          </Link>
                          <button
                            type="button"
                            onClick={() =>
                              unlinkCharter.mutate({
                                meetingId: meeting.id,
                                charterId: mc.charter_id,
                              })
                            }
                            className="text-text-sub hover:text-red-500"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Summary */}
              <div>
                <h4 className="text-sm font-medium text-text-main mb-2">Summary</h4>
                <div className="text-sm bg-surface-alt p-3 rounded-lg border border-border">
                  <RichTextEditor
                    key={`summary-${meetingId}`}
                    content={meeting.summary}
                    onChange={(summary) => saveImmediate({ summary })}
                    placeholder="Add a meeting summary..."
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <h4 className="text-sm font-medium text-text-main mb-2">Notes</h4>
                <div className="text-sm bg-surface-alt p-3 rounded-lg border border-border">
                  <RichTextEditor
                    key={`notes-${meetingId}`}
                    content={meeting.notes}
                    onChange={(notes) => saveImmediate({ notes })}
                    placeholder="Add meeting notes..."
                  />
                </div>
              </div>

              {/* Links */}
              <div>
                <h4 className="text-sm font-medium text-text-main mb-2 flex items-center gap-2">
                  <Link2 className="h-4 w-4" />
                  Links
                </h4>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="h-3.5 w-3.5 text-text-sub" />
                      <span className="text-xs font-medium text-text-sub uppercase">
                        Transcript
                      </span>
                      {!meeting.transcript_url && (
                        <label className="flex items-center gap-1 text-xs text-text-sub ml-auto">
                          <input
                            type="checkbox"
                            checked={meeting.transcript_not_available}
                            onChange={(e) =>
                              saveImmediate({
                                transcript_not_available: e.target.checked,
                              })
                            }
                            className="rounded border-border"
                          />
                          N/A
                        </label>
                      )}
                    </div>
                    <InlineUrl
                      value={meeting.transcript_url}
                      onChange={(transcript_url) =>
                        saveImmediate({ transcript_url })
                      }
                      placeholder="Add transcript URL..."
                      label="Transcript"
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Video className="h-3.5 w-3.5 text-text-sub" />
                      <span className="text-xs font-medium text-text-sub uppercase">
                        Recording
                      </span>
                      {!meeting.recording_url && (
                        <label className="flex items-center gap-1 text-xs text-text-sub ml-auto">
                          <input
                            type="checkbox"
                            checked={meeting.recording_not_available}
                            onChange={(e) =>
                              saveImmediate({
                                recording_not_available: e.target.checked,
                              })
                            }
                            className="rounded border-border"
                          />
                          N/A
                        </label>
                      )}
                    </div>
                    <InlineUrl
                      value={meeting.recording_url}
                      onChange={(recording_url) =>
                        saveImmediate({ recording_url })
                      }
                      placeholder="Add recording URL..."
                      label="Recording"
                    />
                  </div>
                </div>
              </div>

              {/* Tasks from this meeting */}
              {meeting.tasks && meeting.tasks.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-text-main mb-2">
                    Tasks from this Meeting
                  </h4>
                  <div className="space-y-1">
                    {meeting.tasks.map((task) => (
                      <Link
                        key={task.id}
                        href={`/tasks/${task.id}`}
                        className="flex items-center justify-between p-2 rounded border border-border hover:bg-surface-2 transition-colors"
                      >
                        <span className="text-sm text-text-main">
                          {task.title}
                        </span>
                        <Badge
                          variant={getTaskStatusVariant(task.status as any)}
                          className="text-xs"
                        >
                          {getTaskStatusLabel(task.status as any)}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* View Full Details Link */}
              <div className="pt-4 border-t border-border">
                <Link href={`/meetings/${meetingId}`}>
                  <Button variant="secondary" className="w-full">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open Full Screen
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-text-sub">
              Meeting not found
            </div>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
