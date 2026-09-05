import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

// Oracle Projects Tab Phase 5 — drafts a nudge, keyed off WHO owns the blocker. Never
// sends anything itself: a Citadel user gets a plain comment draft (posted through
// usePostInternalComment, is_internal:true, with the owner @-mentioned via
// mentioned_user_ids); a ClientContact gets an email draft the caller opens in Gmail
// (mailto:, Mike sends it himself); a label-only owner (a contractor with no record in
// either table) gets an email draft with an empty `to` and a note at the top of the body
// to fill one in.

const ownerSchema = z
  .object({
    user_id: z.string().uuid().optional(),
    contact_id: z.string().uuid().optional(),
    label: z.string().trim().min(1).max(255).optional(),
  })
  .refine((o) => (o.user_id ? 1 : 0) + (o.contact_id ? 1 : 0) + (o.label ? 1 : 0) === 1, {
    message: 'Provide exactly one of owner.user_id, owner.contact_id, or owner.label',
  });

const nudgeDraftSchema = z.object({
  blocker_id: z.string().min(1).max(255),
  project_id: z.string().uuid(),
  owner: ownerSchema,
});

// Blocker ids are built as `${kind}:${sourceId}` (see lib/oracle/projects/blockers.ts).
// Parsed here (not imported — Blocker itself is a derived, non-persisted shape) so the
// nudge draft can name the actual thing being nudged about, not just the project.
function parseBlockerId(blockerId: string): { kind: string; sourceId: string } {
  const sep = blockerId.indexOf(':');
  if (sep === -1) return { kind: blockerId, sourceId: '' };
  return { kind: blockerId.slice(0, sep), sourceId: blockerId.slice(sep + 1) };
}

const TASK_SOURCED_KINDS = new Set(['decision', 'clarification', 'review', 'mention', 'someone_else']);

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const data = nudgeDraftSchema.parse(body);

    const project = await prisma.project.findUnique({
      where: { id: data.project_id, is_deleted: false },
      select: { id: true, name: true },
    });
    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    const { kind, sourceId } = parseBlockerId(data.blocker_id);
    let subjectContext = project.name;
    if (TASK_SOURCED_KINDS.has(kind) && sourceId) {
      const task = await prisma.task.findUnique({ where: { id: sourceId }, select: { title: true } });
      if (task) subjectContext = task.title;
    }

    if (data.owner.user_id) {
      const user = await prisma.user.findUnique({ where: { id: data.owner.user_id }, select: { id: true, name: true } });
      if (!user) {
        throw new ApiError('User not found', 404);
      }
      return NextResponse.json({
        channel: 'comment' as const,
        to: user.name,
        body: `Checking in on ${subjectContext}. Any update?`,
      });
    }

    if (data.owner.contact_id) {
      const contact = await prisma.clientContact.findUnique({
        where: { id: data.owner.contact_id },
        select: { id: true, email: true, name: true, is_deleted: true },
      });
      if (!contact || contact.is_deleted) {
        throw new ApiError('Contact not found', 404);
      }
      return NextResponse.json({
        channel: 'email' as const,
        to: contact.email,
        subject: `Checking in: ${subjectContext}`,
        body: `Hi,\n\nChecking in on ${subjectContext}. Any update?\n\nMike`,
      });
    }

    // Label-only owner: someone without a Citadel record (a contractor, most often).
    // No address to send to — the draft says so, at the top, in plain language.
    return NextResponse.json({
      channel: 'email' as const,
      to: '',
      subject: `Checking in: ${subjectContext}`,
      body: `Add ${data.owner.label}'s email address before sending.\n\nHi,\n\nChecking in on ${subjectContext}. Any update?\n\nMike`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
