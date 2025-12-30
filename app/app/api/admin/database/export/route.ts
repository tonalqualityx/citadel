import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { exportTables, TABLE_GROUPS, TableGroup } from '@/lib/services/database-backup';

const exportSchema = z.object({
  groups: z.array(z.string()).min(1, 'At least one group must be selected'),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const body = await request.json();
    const { groups } = exportSchema.parse(body);

    // Validate group names
    const validGroups = Object.keys(TABLE_GROUPS);
    for (const group of groups) {
      if (!validGroups.includes(group)) {
        throw new ApiError(`Invalid group: ${group}`, 400);
      }
    }

    // Export tables
    const sql = await exportTables(groups as TableGroup[]);

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `indelible-backup-${timestamp}.sql`;

    // Return as downloadable file
    return new NextResponse(sql, {
      status: 200,
      headers: {
        'Content-Type': 'application/sql',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
