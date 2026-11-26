import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatMilestoneResponse } from '@/lib/api/formatters';
import { ROCK_CAP, QUARTER_PATTERN, lastDayOfQuarter } from '@/lib/milestones/rock';

// The chat's narrow path to flag a milestone as a quarter priority. Only these two fields can be sent; the rules match
// the rock block of PATCH /api/milestones/[id] (design.md 2.4).
const rockSchema = z
  .object({
    rock_quarter: z.string().regex(QUARTER_PATTERN, 'Quarter must look like 2027-Q1').nullable(),
    rock_done_when: z.string().max(300).optional().nullable(),
  })
  .strict();

// PATCH /api/milestones/[id]/rock - mark (quarter plus a done line) or unmark (rock_quarter null) a milestone as a rock
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    const data = rockSchema.parse(await request.json());

    const existing = await prisma.milestone.findUnique({
      where: { id },
      include: { project: { select: { id: true, is_deleted: true, next_step_text: true, next_step_owner_id: true, next_step_at: true } } },
    });
    if (!existing || existing.project.is_deleted) throw new ApiError('Milestone not found', 404);

    // Same rule as PATCH /api/milestones/[id]: tech users reach only milestones on projects they are assigned to
    if (auth.role === 'tech') {
      const isTeamMember = await prisma.projectTeamAssignment.findFirst({ where: { project_id: existing.project_id, user_id: auth.userId } });
      if (!isTeamMember) throw new ApiError('Milestone not found', 404);
    }

    const updateData: Record<string, unknown> = {};
    if (data.rock_quarter === null) {
      // Unmarking clears the done-when line too
      updateData.rock_quarter = null;
      updateData.rock_done_when = null;
    } else {
      const doneWhen = typeof data.rock_done_when === 'string' ? data.rock_done_when.trim() : data.rock_done_when;
      const line = doneWhen || (existing.rock_quarter ? existing.rock_done_when : null);
      if (!line) throw new ApiError('A quarter priority needs a yes-or-no done line', 400, 'rock_needs_done_when');
      const otherRocks = await prisma.milestone.count({
        where: { rock_quarter: data.rock_quarter, id: { not: id }, project: { is_deleted: false } },
      });
      if (otherRocks >= ROCK_CAP) {
        throw new ApiError(`${data.rock_quarter} already has ${ROCK_CAP} quarter priorities`, 409, 'rock_cap');
      }
      updateData.rock_quarter = data.rock_quarter;
      updateData.rock_done_when = line;
      if (!existing.target_date) updateData.target_date = lastDayOfQuarter(data.rock_quarter);
    }

    const milestone = await prisma.milestone.update({ where: { id }, data: updateData });
    return NextResponse.json(formatMilestoneResponse(milestone, existing.project));
  } catch (error) {
    return handleApiError(error);
  }
}
