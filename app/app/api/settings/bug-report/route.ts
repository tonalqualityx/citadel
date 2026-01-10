import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

// Helper to handle null, empty strings, or valid UUIDs
const nullableUuid = z
  .union([z.string().uuid(), z.literal(''), z.null()])
  .transform((val) => (val === '' ? null : val));

const updateSettingsSchema = z.object({
  bug_report_project_id: nullableUuid.optional(),
  bug_report_phase_id: nullableUuid.optional(),
  bug_report_notify_user_id: nullableUuid.optional(),
});

// Get or create singleton settings
async function getOrCreateSettings() {
  let settings = await prisma.appSettings.findUnique({
    where: { id: 'singleton' },
    include: {
      bug_report_project: { select: { id: true, name: true } },
      bug_report_phase: { select: { id: true, name: true } },
      bug_report_notify_user: { select: { id: true, name: true, email: true } },
    },
  });

  if (!settings) {
    settings = await prisma.appSettings.create({
      data: { id: 'singleton' },
      include: {
        bug_report_project: { select: { id: true, name: true } },
        bug_report_phase: { select: { id: true, name: true } },
        bug_report_notify_user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  return settings;
}

function formatSettings(settings: any) {
  return {
    bug_report_project_id: settings.bug_report_project_id,
    bug_report_phase_id: settings.bug_report_phase_id,
    bug_report_notify_user_id: settings.bug_report_notify_user_id,
    bug_report_project: settings.bug_report_project,
    bug_report_phase: settings.bug_report_phase,
    bug_report_notify_user: settings.bug_report_notify_user,
  };
}

export async function GET() {
  try {
    await requireAuth();
    const settings = await getOrCreateSettings();
    return NextResponse.json(formatSettings(settings));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const body = await request.json();
    const data = updateSettingsSchema.parse(body);

    // Ensure settings exist
    await getOrCreateSettings();

    // Update settings
    const settings = await prisma.appSettings.update({
      where: { id: 'singleton' },
      data: {
        bug_report_project_id: data.bug_report_project_id,
        bug_report_phase_id: data.bug_report_phase_id,
        bug_report_notify_user_id: data.bug_report_notify_user_id,
      },
      include: {
        bug_report_project: { select: { id: true, name: true } },
        bug_report_phase: { select: { id: true, name: true } },
        bug_report_notify_user: { select: { id: true, name: true, email: true } },
      },
    });

    return NextResponse.json(formatSettings(settings));
  } catch (error) {
    return handleApiError(error);
  }
}
