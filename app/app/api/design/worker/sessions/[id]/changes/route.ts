import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { idParam, requireWorker, workerBody } from '@/lib/design/worker-kit';

const sha = z.string().regex(/^[0-9a-f]{7,64}$/i);
const schema = z.object({
  commit_sha: sha,
  parent_sha: sha.nullish(),
  summary: z.string().min(1).max(500),
  files: z.array(z.string().max(300)).max(500).default([]),
  data_libs: z.array(z.string().max(100)).max(200).default([]),
  pages: z.array(z.string().max(300)).max(1000).default([]),
  render_count: z.number().int().min(0).nullish(),
  pin_ids: z.array(z.string().uuid()).max(100).default([]),
  gates: z.array(z.record(z.string(), z.unknown())).max(50).nullish(),
  apply_event_seq: z.number().int().positive().nullish(),
  is_restore: z.boolean().optional(),
  restored_from: sha.nullish(),
});

const shape = (c: Record<string, unknown>) => c;

// Unique on (session, commit_sha): a repeat is a 200 with the existing row. Marks the listed pins resolved.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWorker();
    const id = idParam((await params).id, 'Session not found');
    const b = await workerBody(request, schema);
    const session = await prisma.designSession.findUnique({ where: { id }, select: { id: true } });
    if (!session) throw new ApiError('Session not found', 404, 'not_found');
    const existing = await prisma.designChange.findUnique({ where: { session_id_commit_sha: { session_id: id, commit_sha: b.commit_sha } } });
    if (existing) return NextResponse.json({ change: shape(existing) }, { status: 200 });
    try {
      const change = await prisma.$transaction(async (tx) => {
        const c = await tx.designChange.create({
          data: {
            session_id: id, commit_sha: b.commit_sha, parent_sha: b.parent_sha ?? null, summary: b.summary, files: b.files,
            data_libs: b.data_libs, pages: b.pages, render_count: b.render_count ?? null, pin_ids: b.pin_ids,
            gates: (b.gates ?? undefined) as Prisma.InputJsonValue | undefined, apply_event_seq: b.apply_event_seq ?? null,
            is_restore: b.is_restore ?? false, restored_from: b.restored_from ?? null,
          },
        });
        if (b.pin_ids.length > 0) {
          await tx.designPin.updateMany({ where: { session_id: id, id: { in: b.pin_ids }, status: { in: ['pending', 'sent'] } }, data: { status: 'resolved' } });
        }
        return c;
      });
      return NextResponse.json({ change: shape(change) }, { status: 201 });
    } catch (e) {
      // A concurrent insert of the same commit: return the winner as a repeat.
      const again = await prisma.designChange.findUnique({ where: { session_id_commit_sha: { session_id: id, commit_sha: b.commit_sha } } });
      if (again) return NextResponse.json({ change: shape(again) }, { status: 200 });
      throw e;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
