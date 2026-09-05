import { describe, it, expect } from 'vitest';
import {
  projectNoteKeys,
  type ProjectNote,
  type ProjectNotesResponse,
  type CreateProjectNoteInput,
} from '../use-project-notes';

describe('projectNoteKeys', () => {
  it('generates the correct base query key', () => {
    expect(projectNoteKeys.all).toEqual(['project-notes']);
  });

  it('generates the correct project-specific query key', () => {
    expect(projectNoteKeys.project('project-123')).toEqual(['project-notes', 'project-123']);
  });

  it('handles different project ids correctly', () => {
    expect(projectNoteKeys.project('abc')).toEqual(['project-notes', 'abc']);
    expect(projectNoteKeys.project('')).toEqual(['project-notes', '']);
  });
});

describe('ProjectNote type interfaces', () => {
  it('accepts a valid note-kind ProjectNote', () => {
    const note: ProjectNote = {
      id: 'note-1',
      project_id: 'project-1',
      user_id: 'user-1',
      user: { id: 'user-1', name: 'Mike' },
      kind: 'note',
      body: 'Called the client, waiting on their DNS access.',
      until_date: null,
      is_deleted: false,
      created_at: '2026-09-04T00:00:00Z',
      updated_at: '2026-09-04T00:00:00Z',
    };

    expect(note.kind).toBe('note');
    expect(note.until_date).toBeNull();
  });

  it('accepts a valid parked_until ProjectNote', () => {
    const note: ProjectNote = {
      id: 'note-2',
      project_id: 'project-1',
      user_id: 'user-1',
      user: null,
      kind: 'parked_until',
      body: 'Waiting on client budget approval',
      until_date: '2026-09-15T00:00:00Z',
      is_deleted: false,
      created_at: '2026-09-04T00:00:00Z',
      updated_at: '2026-09-04T00:00:00Z',
    };

    expect(note.kind).toBe('parked_until');
    expect(note.until_date).toBe('2026-09-15T00:00:00Z');
  });

  it('accepts a valid ProjectNotesResponse', () => {
    const response: ProjectNotesResponse = {
      notes: [
        {
          id: 'note-1',
          project_id: 'project-1',
          user_id: 'user-1',
          user: { id: 'user-1', name: 'Mike' },
          kind: 'note',
          body: 'Test',
          until_date: null,
          is_deleted: false,
          created_at: '2026-09-04T00:00:00Z',
          updated_at: '2026-09-04T00:00:00Z',
        },
      ],
      count: 1,
    };

    expect(response.notes).toHaveLength(1);
    expect(response.count).toBe(1);
  });

  it('accepts a minimal CreateProjectNoteInput (kind defaults server-side)', () => {
    const input: CreateProjectNoteInput = { body: 'Quick log entry' };
    expect(input.body).toBe('Quick log entry');
    expect(input.kind).toBeUndefined();
  });

  it('accepts a full parked_until CreateProjectNoteInput', () => {
    const input: CreateProjectNoteInput = {
      kind: 'parked_until',
      body: 'Snoozed pending client reply',
      until_date: '2026-09-20T00:00:00Z',
    };
    expect(input.kind).toBe('parked_until');
    expect(input.until_date).toBe('2026-09-20T00:00:00Z');
  });
});
