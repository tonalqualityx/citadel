import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { truncateTables, importSql, TABLE_GROUPS, TableGroup } from '@/lib/services/database-backup';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const groupsJson = formData.get('groups') as string | null;

    if (!file) {
      throw new ApiError('No file provided', 400);
    }

    if (!groupsJson) {
      throw new ApiError('No groups specified', 400);
    }

    // Parse and validate groups
    let groups: string[];
    try {
      groups = JSON.parse(groupsJson);
    } catch {
      throw new ApiError('Invalid groups format', 400);
    }

    if (!Array.isArray(groups) || groups.length === 0) {
      throw new ApiError('At least one group must be selected', 400);
    }

    const validGroups = Object.keys(TABLE_GROUPS);
    for (const group of groups) {
      if (!validGroups.includes(group)) {
        throw new ApiError(`Invalid group: ${group}`, 400);
      }
    }

    // Validate file is SQL
    if (!file.name.endsWith('.sql')) {
      throw new ApiError('File must be a .sql file', 400);
    }

    // Read file content
    const sql = await file.text();

    if (!sql.trim()) {
      throw new ApiError('SQL file is empty', 400);
    }

    // Basic SQL validation - check for common pg_dump markers
    if (!sql.includes('COPY') && !sql.includes('INSERT')) {
      throw new ApiError('File does not appear to be a valid pg_dump SQL file', 400);
    }

    // Truncate selected tables first
    console.log('Truncating tables for groups:', groups);
    await truncateTables(groups as TableGroup[]);

    // Import the SQL
    console.log('Importing SQL data...');
    await importSql(sql);

    return NextResponse.json({
      success: true,
      message: 'Database imported successfully',
    });
  } catch (error) {
    console.error('Import error:', error);
    return handleApiError(error);
  }
}

// Increase body size limit for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};
