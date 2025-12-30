import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import {
  generateAllDueMaintenance,
  generateMaintenanceTasksForSite,
} from '@/lib/services/maintenance-generator';

const generateSchema = z.object({
  siteId: z.string().uuid().optional(),
});

/**
 * Admin endpoint to manually trigger maintenance task generation
 *
 * POST /api/admin/maintenance/generate
 * Body: { siteId?: string } - Optional site ID to generate for specific site
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const body = await request.json().catch(() => ({}));
    const { siteId } = generateSchema.parse(body);

    if (siteId) {
      // Generate for specific site
      const result = await generateMaintenanceTasksForSite(siteId);

      if (!result) {
        return NextResponse.json({
          success: true,
          message: 'No tasks generated - site may not have a maintenance plan, already generated for this period, or no SOPs configured',
        });
      }

      return NextResponse.json({
        success: true,
        result,
      });
    } else {
      // Generate for all due sites
      const summary = await generateAllDueMaintenance();

      return NextResponse.json({
        success: true,
        summary: {
          sitesProcessed: summary.totalSitesProcessed,
          tasksCreated: summary.totalTasksCreated,
          tasksAbandoned: summary.totalTasksAbandoned,
          errors: summary.errors,
        },
        results: summary.results,
      });
    }
  } catch (error) {
    return handleApiError(error);
  }
}
