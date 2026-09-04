'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { formatRelativeTime } from '@/lib/utils/time';
import { useProjectNotes, useCreateProjectNote } from '@/lib/hooks/use-project-notes';

interface NotesLogProps {
  projectId: string;
}

// Oracle Projects Tab Phase 4 — the drawer's Notes log section: a free-form log entry,
// or a "park until" snooze note (which also mutes the stale blocker until that date —
// see the notes route's own doc comment).
export function NotesLog({ projectId }: NotesLogProps) {
  const { data, isLoading } = useProjectNotes(projectId);
  const createNote = useCreateProjectNote(projectId);
  const [text, setText] = React.useState('');
  const [parkDate, setParkDate] = React.useState('');
  const [showPark, setShowPark] = React.useState(false);

  async function addNote() {
    if (!text.trim()) return;
    await createNote.mutateAsync({ body: text.trim() });
    setText('');
  }

  async function parkUntil() {
    if (!text.trim() || !parkDate) return;
    const untilIso = new Date(`${parkDate}T00:00:00.000Z`).toISOString();
    await createNote.mutateAsync({ kind: 'parked_until', body: text.trim(), until_date: untilIso });
    setText('');
    setParkDate('');
    setShowPark(false);
  }

  return (
    <div className="flex flex-col gap-3" data-testid="notes-log">
      <div className="flex flex-col gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a note..."
          rows={2}
        />
        {showPark && (
          <Input
            type="date"
            value={parkDate}
            onChange={(e) => setParkDate(e.target.value)}
            aria-label="Park until"
          />
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={addNote} disabled={createNote.isPending || !text.trim()}>
            Add note
          </Button>
          {!showPark && (
            <Button size="sm" variant="secondary" onClick={() => setShowPark(true)}>
              Park until…
            </Button>
          )}
          {showPark && (
            <Button
              size="sm"
              variant="secondary"
              onClick={parkUntil}
              disabled={createNote.isPending || !text.trim() || !parkDate}
            >
              Park
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {isLoading && <div className="text-sm text-text-sub">Loading notes...</div>}
        {!isLoading && (data?.notes.length ?? 0) === 0 && (
          <div className="text-sm text-text-sub">No notes yet.</div>
        )}
        {data?.notes.map((note) => (
          <div key={note.id} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between text-xs text-text-sub">
              <span>{note.user?.name ?? 'Unknown'}</span>
              <span>{formatRelativeTime(note.created_at)}</span>
            </div>
            <div className="mt-1 text-text-main">{note.body}</div>
            {note.kind === 'parked_until' && note.until_date && (
              <div className="mt-1 text-xs" style={{ color: 'var(--warning)' }}>
                Parked until {new Date(note.until_date).toLocaleDateString()}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
