'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ExternalLink,
  Calendar,
  Building2,
  Plus,
  X,
  Users,
  LinkIcon,
  FileText,
  ListTodo,
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
  useCreateTaskFromMeeting,
} from '@/lib/hooks/use-meetings';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Textarea } from '@/components/ui/textarea';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

const taskStatusBadge: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  done: 'success',
  in_progress: 'warning',
  blocked: 'error',
};

export default function MeetingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useTerminology();
  const id = params.id as string;

  const { data: meeting, isLoading, error } = useMeeting(id);
  const updateMeeting = useUpdateMeeting();
  const addAttendee = useAddMeetingAttendee();
  const removeAttendee = useRemoveMeetingAttendee();
  const linkAccord = useLinkMeetingAccord();
  const unlinkAccord = useUnlinkMeetingAccord();
  const linkProject = useLinkMeetingProject();
  const unlinkProject = useUnlinkMeetingProject();
  const linkCharter = useLinkMeetingCharter();
  const unlinkCharter = useUnlinkMeetingCharter();
  const createTask = useCreateTaskFromMeeting();

  // Inline editable fields
  const [editingTitle, setEditingTitle] = React.useState(false);
  const [titleValue, setTitleValue] = React.useState('');
  const [summaryValue, setSummaryValue] = React.useState('');
  const [notesValue, setNotesValue] = React.useState('');
  const [clientAttendeesValue, setClientAttendeesValue] = React.useState('');
  const [transcriptUrl, setTranscriptUrl] = React.useState('');
  const [recordingUrl, setRecordingUrl] = React.useState('');

  // New task form
  const [showNewTask, setShowNewTask] = React.useState(false);
  const [newTaskTitle, setNewTaskTitle] = React.useState('');

  // Link forms
  const [showAddAttendee, setShowAddAttendee] = React.useState(false);
  const [newAttendeeId, setNewAttendeeId] = React.useState('');
  const [showLinkAccord, setShowLinkAccord] = React.useState(false);
  const [newAccordId, setNewAccordId] = React.useState('');
  const [showLinkProject, setShowLinkProject] = React.useState(false);
  const [newProjectId, setNewProjectId] = React.useState('');
  const [showLinkCharter, setShowLinkCharter] = React.useState(false);
  const [newCharterId, setNewCharterId] = React.useState('');

  // Sync form state when meeting data loads
  React.useEffect(() => {
    if (meeting) {
      setTitleValue(meeting.title);
      setSummaryValue(meeting.summary ?? '');
      setNotesValue(meeting.notes ?? '');
      setClientAttendeesValue(meeting.client_attendees ?? '');
      setTranscriptUrl(meeting.transcript_url ?? '');
      setRecordingUrl(meeting.recording_url ?? '');
    }
  }, [meeting]);

  const handleFieldBlur = (field: string, value: string | null) => {
    if (!meeting) return;
    const currentValue = meeting[field as keyof typeof meeting];
    if (value === currentValue) return;

    updateMeeting.mutate({ id, data: { [field]: value || null } });
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !meeting) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<Calendar className="h-12 w-12" />}
          title="Meeting not found"
          description="This meeting may have been deleted or you don't have access."
          action={
            <Button onClick={() => router.push('/meetings')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Meetings
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Back button */}
      <Link
        href="/meetings"
        className="inline-flex items-center gap-2 text-sm text-text-sub hover:text-text-main transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {t('meetings')}
      </Link>

      {/* Header */}
      <div className="space-y-2">
        {editingTitle ? (
          <Input
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={() => {
              setEditingTitle(false);
              handleFieldBlur('title', titleValue);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setEditingTitle(false);
                handleFieldBlur('title', titleValue);
              }
              if (e.key === 'Escape') {
                setEditingTitle(false);
                setTitleValue(meeting.title);
              }
            }}
            autoFocus
            className="text-2xl font-semibold"
          />
        ) : (
          <h1
            className="text-2xl font-semibold text-text-main cursor-pointer hover:text-primary transition-colors"
            onClick={() => setEditingTitle(true)}
          >
            {meeting.title}
          </h1>
        )}
        <div className="flex items-center gap-4 text-sm text-text-sub">
          <span className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4" />
            {formatDate(meeting.meeting_date)}
          </span>
          {meeting.client && (
            <Link
              href={`/clients/${meeting.client.id}`}
              className="flex items-center gap-1.5 hover:text-primary transition-colors"
            >
              <Building2 className="h-4 w-4" />
              {meeting.client.name}
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content - left 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={summaryValue}
                onChange={(e) => setSummaryValue(e.target.value)}
                onBlur={() => handleFieldBlur('summary', summaryValue)}
                placeholder="Meeting summary..."
                rows={4}
                className="resize-y"
              />
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                onBlur={() => handleFieldBlur('notes', notesValue)}
                placeholder="Meeting notes..."
                rows={6}
                className="resize-y"
              />
            </CardContent>
          </Card>

          {/* Tasks */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <ListTodo className="h-4 w-4" />
                Tasks
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowNewTask(true)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Create Task
              </Button>
            </CardHeader>
            <CardContent>
              {meeting.tasks && meeting.tasks.length > 0 ? (
                <div className="space-y-2">
                  {meeting.tasks.map((task) => (
                    <Link
                      key={task.id}
                      href={`/tasks?task=${task.id}`}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-background-light transition-colors"
                    >
                      <span className="text-sm text-text-main">{task.title}</span>
                      <div className="flex items-center gap-2">
                        {task.assignee && (
                          <span className="text-xs text-text-sub">
                            {task.assignee.name}
                          </span>
                        )}
                        <Badge
                          variant={taskStatusBadge[task.status] ?? 'default'}
      
                        >
                          {task.status.replace('_', ' ')}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-sub">No tasks yet.</p>
              )}

              {/* New task form */}
              {showNewTask && (
                <form
                  className="flex items-center gap-2 mt-3 pt-3 border-t border-border-warm"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newTaskTitle.trim()) return;
                    createTask.mutate(
                      { meetingId: id, data: { title: newTaskTitle.trim() } },
                      {
                        onSuccess: () => {
                          setNewTaskTitle('');
                          setShowNewTask(false);
                        },
                      }
                    );
                  }}
                >
                  <Input
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="Task title..."
                    autoFocus
                    className="flex-1"
                  />
                  <Button type="submit" size="sm" disabled={createTask.isPending}>
                    Add
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"

                    onClick={() => {
                      setShowNewTask(false);
                      setNewTaskTitle('');
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - right column */}
        <div className="space-y-6">
          {/* Attendees */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                Attendees
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAddAttendee(true)}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Team attendees */}
              {meeting.attendees && meeting.attendees.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-text-sub uppercase tracking-wider">
                    Team
                  </p>
                  {meeting.attendees.map((attendee) => (
                    <div
                      key={attendee.id}
                      className="flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center">
                          <span className="text-xs font-medium text-primary">
                            {(attendee.user?.name ?? '?')[0].toUpperCase()}
                          </span>
                        </div>
                        <span className="text-sm text-text-main">
                          {attendee.user?.name ?? 'Unknown'}
                        </span>
                      </div>
                      <button
                        onClick={() =>
                          removeAttendee.mutate({
                            meetingId: id,
                            attendeeId: attendee.id,
                          })
                        }
                        className="text-text-sub hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-sub">No team attendees.</p>
              )}

              {/* Add attendee form */}
              {showAddAttendee && (
                <form
                  className="flex items-center gap-2 pt-2 border-t border-border-warm"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newAttendeeId.trim()) return;
                    addAttendee.mutate(
                      { meetingId: id, user_id: newAttendeeId.trim() },
                      {
                        onSuccess: () => {
                          setNewAttendeeId('');
                          setShowAddAttendee(false);
                        },
                      }
                    );
                  }}
                >
                  <Input
                    value={newAttendeeId}
                    onChange={(e) => setNewAttendeeId(e.target.value)}
                    placeholder="User ID"
                    autoFocus
                    className="flex-1"

                  />
                  <Button type="submit" size="sm">
                    Add
                  </Button>
                </form>
              )}

              {/* Client attendees */}
              <div className="pt-2 border-t border-border-warm">
                <p className="text-xs font-medium text-text-sub uppercase tracking-wider mb-1">
                  Client
                </p>
                <Input
                  value={clientAttendeesValue}
                  onChange={(e) => setClientAttendeesValue(e.target.value)}
                  onBlur={() =>
                    handleFieldBlur('client_attendees', clientAttendeesValue)
                  }
                  placeholder="Client attendee names..."
                />
              </div>
            </CardContent>
          </Card>

          {/* Associations */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <LinkIcon className="h-4 w-4" />
                Linked
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Accords */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-text-sub uppercase tracking-wider">
                    {t('deals')}
                  </p>
                  <Button
                    variant="ghost"

                    onClick={() => setShowLinkAccord(true)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {meeting.meeting_accords?.map((ma) => (
                    <Badge key={ma.id} size="sm" className="group">
                      {ma.accord?.name ?? 'Unknown'}
                      <button
                        onClick={() =>
                          unlinkAccord.mutate({
                            meetingId: id,
                            accordId: ma.accord_id,
                          })
                        }
                        className="ml-1 opacity-0 group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {(!meeting.meeting_accords || meeting.meeting_accords.length === 0) && (
                    <span className="text-xs text-text-sub">None</span>
                  )}
                </div>
                {showLinkAccord && (
                  <form
                    className="flex items-center gap-2 mt-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newAccordId.trim()) return;
                      linkAccord.mutate(
                        { meetingId: id, accord_id: newAccordId.trim() },
                        {
                          onSuccess: () => {
                            setNewAccordId('');
                            setShowLinkAccord(false);
                          },
                        }
                      );
                    }}
                  >
                    <Input
                      value={newAccordId}
                      onChange={(e) => setNewAccordId(e.target.value)}
                      placeholder="Accord ID"
                      autoFocus
  
                      className="flex-1"
                    />
                    <Button type="submit" size="sm">
                      Link
                    </Button>
                  </form>
                )}
              </div>

              {/* Projects */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-text-sub uppercase tracking-wider">
                    {t('projects')}
                  </p>
                  <Button
                    variant="ghost"

                    onClick={() => setShowLinkProject(true)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {meeting.meeting_projects?.map((mp) => (
                    <Badge key={mp.id} size="sm" className="group">
                      {mp.project?.name ?? 'Unknown'}
                      <button
                        onClick={() =>
                          unlinkProject.mutate({
                            meetingId: id,
                            projectId: mp.project_id,
                          })
                        }
                        className="ml-1 opacity-0 group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {(!meeting.meeting_projects || meeting.meeting_projects.length === 0) && (
                    <span className="text-xs text-text-sub">None</span>
                  )}
                </div>
                {showLinkProject && (
                  <form
                    className="flex items-center gap-2 mt-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newProjectId.trim()) return;
                      linkProject.mutate(
                        { meetingId: id, project_id: newProjectId.trim() },
                        {
                          onSuccess: () => {
                            setNewProjectId('');
                            setShowLinkProject(false);
                          },
                        }
                      );
                    }}
                  >
                    <Input
                      value={newProjectId}
                      onChange={(e) => setNewProjectId(e.target.value)}
                      placeholder="Project ID"
                      autoFocus
  
                      className="flex-1"
                    />
                    <Button type="submit" size="sm">
                      Link
                    </Button>
                  </form>
                )}
              </div>

              {/* Charters */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-text-sub uppercase tracking-wider">
                    {t('retainers')}
                  </p>
                  <Button
                    variant="ghost"

                    onClick={() => setShowLinkCharter(true)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {meeting.meeting_charters?.map((mc) => (
                    <Badge key={mc.id} size="sm" className="group">
                      {mc.charter?.name ?? 'Unknown'}
                      <button
                        onClick={() =>
                          unlinkCharter.mutate({
                            meetingId: id,
                            charterId: mc.charter_id,
                          })
                        }
                        className="ml-1 opacity-0 group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {(!meeting.meeting_charters || meeting.meeting_charters.length === 0) && (
                    <span className="text-xs text-text-sub">None</span>
                  )}
                </div>
                {showLinkCharter && (
                  <form
                    className="flex items-center gap-2 mt-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newCharterId.trim()) return;
                      linkCharter.mutate(
                        { meetingId: id, charter_id: newCharterId.trim() },
                        {
                          onSuccess: () => {
                            setNewCharterId('');
                            setShowLinkCharter(false);
                          },
                        }
                      );
                    }}
                  >
                    <Input
                      value={newCharterId}
                      onChange={(e) => setNewCharterId(e.target.value)}
                      placeholder="Charter ID"
                      autoFocus
  
                      className="flex-1"
                    />
                    <Button type="submit" size="sm">
                      Link
                    </Button>
                  </form>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Links */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Links
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-sub mb-1">
                  Transcript URL
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    value={transcriptUrl}
                    onChange={(e) => setTranscriptUrl(e.target.value)}
                    onBlur={() => handleFieldBlur('transcript_url', transcriptUrl)}
                    placeholder="https://..."

                    className="flex-1"
                  />
                  {transcriptUrl && (
                    <a
                      href={transcriptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-text-sub hover:text-primary transition-colors"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-sub mb-1">
                  Recording URL
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    value={recordingUrl}
                    onChange={(e) => setRecordingUrl(e.target.value)}
                    onBlur={() => handleFieldBlur('recording_url', recordingUrl)}
                    placeholder="https://..."

                    className="flex-1"
                  />
                  {recordingUrl && (
                    <a
                      href={recordingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-text-sub hover:text-primary transition-colors"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
