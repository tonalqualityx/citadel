import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

// GET /api/sops/tags — distinct list of tags across active SOPs, sorted.
// Powers the tag filter on the SOP list screen (so the dropdown shows every
// tag in use, not just those on the current page).
export async function GET() {
  try {
    await requireAuth();

    const rows = await prisma.sop.findMany({
      where: { is_active: true },
      select: { tags: true },
    });

    const tags = Array.from(
      new Set(rows.flatMap((row) => row.tags ?? []))
    ).sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ tags });
  } catch (error) {
    return handleApiError(error);
  }
}
