import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logUpdate } from '@/lib/services/activity';

// Oracle Projects Tab Phase 3 — Mike's manual next-step override.
//
// PATCH sets a sticky override line (next_step_source='mike') that wins over both the
// nightly/on-demand Bast inference and the live task-graph candidate — see
// lib/oracle/projects/next-step-candidate.ts's mergeNextStep for the precedence.
// owner_id and owner_label are mutually exclusive: owner_id names a User (e.g. a team
// member), owner_label is free text for someone who isn't a User (e.g. "Andy (client)").
// Neither is required — Mike can leave the line with no named owner. Whichever of the
// two IS provided replaces the other (a PATCH always sets both owner fields, clearing
// whichever one wasn't sent), matching the "this PATCH is the whole new line" contract.
//
// DELETE clears the override: next_step_source goes back to null (and text/owner/at are
// cleared with it) so the next refresh's bast line, or the live graph candidate, applies
// again. It does NOT itself trigger a refresh — pair with POST .../refresh if a fresh
// bast line is wanted immediately.
const patchSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    owner_id: z.string().uuid().optional(),
    owner_label: z.string().trim().min(1).max(255).optional(),
  })
  .refine((data) => !(data.owner_id && data.owner_label), {
    message: 'Provide at most one of owner_id or owner_label',
  });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id: projectId } = await params;

    const project = await prisma.project.findUnique({
      where: { id: projectId, is_deleted: false },
      select: { id: true, name: true, next_step_text: true },
    });
    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    const body = await request.json();
    const data = patchSchema.parse(body);

    if (data.owner_id) {
      const owner = await prisma.user.findUnique({ where: { id: data.owner_id }, select: { id: true } });
      if (!owner) {
        throw new ApiError('Owner not found', 404);
      }
    }

    const now = new Date();
    const updated = await prisma.project.update({
      where: { id: projectId },
      data: {
        next_step_text: data.text,
        next_step_owner_id: data.owner_id ?? null,
        next_step_owner_label: data.owner_label ?? null,
        next_step_source: 'mike',
        next_step_at: now,
      },
      include: { next_step_owner: { select: { id: true, name: true } } },
    });

    // LOW-d fix (verification pass): `from` now records the project's ACTUAL prior
    // next_step_text (previously hardcoded `null` regardless of what was there before —
    // an override replacing an existing bast/graph line looked, in the activity log,
    // indistinguishable from one replacing nothing).
    await logUpdate(auth.userId, 'project', projectId, project.name, {
      next_step: { from: project.next_step_text, to: data.text },
    });

    return NextResponse.json({
      next_step: {
        text: updated.next_step_text,
        owner: updated.next_step_owner ? { id: updated.next_step_owner.id, name: updated.next_step_owner.name } : null,
        owner_label: updated.next_step_owner_label,
        source: updated.next_step_source,
        at: updated.next_step_at?.toISOString() ?? null,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id: projectId } = await params;

    const project = await prisma.project.findUnique({
      where: { id: projectId, is_deleted: false },
      select: { id: true, name: true, next_step_text: true, next_step_source: true },
    });
    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    await prisma.project.update({
      where: { id: projectId },
      data: {
        next_step_text: null,
        next_step_owner_id: null,
        next_step_owner_label: null,
        next_step_source: null,
        next_step_at: null,
      },
    });

    // LOW-d fix (verification pass): `from` records the project's actual prior
    // next_step_source/text rather than a hardcoded 'mike' — DELETE is normally called
    // only when an override IS in place, but a stale UI or a direct API call could hit
    // it when it isn't, and the log should say what was really cleared, not assume.
    await logUpdate(auth.userId, 'project', projectId, project.name, {
      next_step_override: { from: project.next_step_source, to: null },
      next_step: { from: project.next_step_text, to: null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
