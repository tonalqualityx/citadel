import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logCreate } from '@/lib/services/activity';
import { recomputeStaleMutedUntil } from '@/lib/services/project-notes';

// Oracle Projects Phase 1 — the project notes log. `note` is a free-form log entry;
// `parked_until` is a snooze note that ALSO stamps Project.stale_muted_until (Mike's
// "stale" blocker mute) — until_date is required for that kind only. See
// prisma/schema.prisma's ProjectNote/ProjectNoteKind doc comments for the full contract.
const createNoteSchema = z
  .object({
    kind: z.enum(['note', 'parked_until']).optional().default('note'),
    body: z.string().min(1).max(10000),
    until_date: z.string().datetime().optional().nullable(),
  })
  .refine((data) => data.kind !== 'parked_until' || !!data.until_date, {
    message: 'until_date is required when kind is parked_until',
    path: ['until_date'],
  });

interface ProjectNoteWithUser {
  id: string;
  project_id: string;
  user_id: string;
  user: { id: string; name: string } | null;
  kind: string;
  body: string;
  until_date: Date | null;
  is_deleted: boolean;
  created_at: Date;
  updated_at: Date;
}

function formatProjectNoteResponse(note: ProjectNoteWithUser) {
  return {
    id: note.id,
    project_id: note.project_id,
    user_id: note.user_id,
    user: note.user ? { id: note.user.id, name: note.user.name } : null,
    kind: note.kind,
    body: note.body,
    until_date: note.until_date ?? null,
    is_deleted: note.is_deleted,
    created_at: note.created_at,
    updated_at: note.updated_at,
  };
}

// GET /api/projects/[id]/notes — list non-deleted notes, newest first.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth();
    const { id: projectId } = await params;

    const project = await prisma.project.findUnique({
      where: { id: projectId, is_deleted: false },
      select: { id: true },
    });
    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    const notes = await prisma.projectNote.findMany({
      where: { project_id: projectId, is_deleted: false },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { created_at: 'desc' },
    });

    return NextResponse.json({
      notes: notes.map(formatProjectNoteResponse),
      count: notes.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/projects/[id]/notes — create a note (or a parked_until snooze).
// Project.stale_muted_until is recomputed after every create as MAX(until_date) over
// this project's live parked_until notes (see recomputeStaleMutedUntil) — a plain `note`
// create is a no-op for the mute; a `parked_until` create can only move it forward or
// leave it unchanged, never backward.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id: projectId } = await params;

    const project = await prisma.project.findUnique({
      where: { id: projectId, is_deleted: false },
      select: { id: true, name: true },
    });
    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    const body = await request.json();
    const data = createNoteSchema.parse(body);

    // Oracle Projects Phase 1 follow-up (verification) — the note write and the
    // stale-mute recompute happen inside one transaction: stale_muted_until is always
    // MAX(until_date) over live parked_until notes, never keyed on this note's own
    // until_date directly. See lib/services/project-notes.ts for the full rationale.
    const note = await prisma.$transaction(async (tx) => {
      const created = await tx.projectNote.create({
        data: {
          project_id: projectId,
          user_id: auth.userId,
          kind: data.kind,
          body: data.body,
          until_date: data.until_date ? new Date(data.until_date) : null,
        },
        include: { user: { select: { id: true, name: true } } },
      });

      await recomputeStaleMutedUntil(tx, projectId);

      return created;
    });

    await logCreate(auth.userId, 'project_note', note.id, project.name);

    return NextResponse.json(formatProjectNoteResponse(note), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
