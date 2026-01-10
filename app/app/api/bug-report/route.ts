import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { notifyBugReported } from '@/lib/services/notifications';
import { calculateEstimatedMinutes } from '@/lib/calculations/energy';
import { MysteryFactor } from '@prisma/client';

const bugReportSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  priority: z.number().min(1).max(4),
  page_url: z.string(),
  browser_info: z.string().optional(),
  console_logs: z.string().optional(),
});

// Helper to create a BlockNote paragraph block
function createParagraphBlock(text: string): any {
  return {
    id: crypto.randomUUID(),
    type: 'paragraph',
    content: text ? [{ type: 'text', text, styles: {} }] : [],
    children: [],
  };
}

// Helper to create a BlockNote heading block
function createHeadingBlock(text: string, level: 1 | 2 | 3 = 2): any {
  return {
    id: crypto.randomUUID(),
    type: 'heading',
    props: { level },
    content: [{ type: 'text', text, styles: {} }],
    children: [],
  };
}

// Helper to create a BlockNote bullet list item
function createBulletItem(text: string): any {
  return {
    id: crypto.randomUUID(),
    type: 'bulletListItem',
    content: [{ type: 'text', text, styles: {} }],
    children: [],
  };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();

    const body = await request.json();
    const data = bugReportSchema.parse(body);

    // Get bug report settings
    const settings = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
    });

    if (!settings?.bug_report_project_id || !settings?.bug_report_phase_id) {
      throw new ApiError('Bug reporting is not configured', 400);
    }

    // Get reporter info
    const reporter = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { name: true },
    });

    // Build the description as BlockNote JSON format
    const blocks: any[] = [];

    // User's description (if provided)
    if (data.description) {
      blocks.push(createParagraphBlock(data.description));
      blocks.push(createParagraphBlock('')); // Empty line
    }

    // Debug Information section
    blocks.push(createHeadingBlock('Debug Information', 3));
    blocks.push(createBulletItem(`Page: ${data.page_url}`));
    blocks.push(createBulletItem(`Reported at: ${new Date().toISOString()}`));
    if (data.browser_info) {
      blocks.push(createBulletItem(`Browser: ${data.browser_info}`));
    }

    // Console Logs section
    blocks.push(createParagraphBlock('')); // Empty line
    blocks.push(createHeadingBlock('Console Logs', 3));
    if (data.console_logs) {
      // Split console logs by newline and create paragraph for each
      const logLines = data.console_logs.split('\n').filter(line => line.trim());
      for (const line of logLines) {
        blocks.push(createParagraphBlock(line));
      }
    } else {
      blocks.push(createParagraphBlock('No console errors or warnings captured.'));
    }

    // Stringify for storage in Text field
    const descriptionJson = JSON.stringify(blocks);

    // Bug reports: energy_estimate = 2 (30 min), mystery_factor = significant
    const energyEstimate = 2;
    const mysteryFactor = MysteryFactor.significant;
    const estimatedMinutes = calculateEstimatedMinutes(energyEstimate, mysteryFactor);

    // Create the task
    const task = await prisma.task.create({
      data: {
        title: data.title,
        description: descriptionJson,
        priority: data.priority,
        status: 'not_started',
        project_id: settings.bug_report_project_id,
        phase_id: settings.bug_report_phase_id,
        created_by_id: auth.userId,
        is_billable: false,
        energy_estimate: energyEstimate,
        mystery_factor: mysteryFactor,
        estimated_minutes: estimatedMinutes,
      },
    });

    // Send notification for high priority bugs
    if (settings.bug_report_notify_user_id) {
      await notifyBugReported(
        task.id,
        task.title,
        data.priority,
        settings.bug_report_notify_user_id,
        reporter?.name || 'Unknown'
      );
    }

    return NextResponse.json({
      id: task.id,
      title: task.title,
      priority: task.priority,
    }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
