import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

/**
 * Site stats ingest (Portal v2 phase 1).
 *
 * Machine-side collectors (GA4, uptime monitors, rank trackers, etc. — a separate, not-yet-built
 * subsystem) push periodic snapshots here. This endpoint owns ONLY the ingest contract: envelope
 * validation, site resolution, and an idempotent upsert into `site_stats_snapshots`. It does not
 * fetch analytics itself.
 *
 * `payload` is intentionally loosely typed at the DB layer (Json column) — the shape below is the
 * documented CONTRACT collectors should conform to, so GET /api/portal/stats can read it back with
 * a consistent client-safe projection. Every field is optional; a collector may send only what it
 * has for a given period (e.g. an uptime-only collector sends just `uptime_pct`).
 */
export interface SiteStatsPayload {
  /** Leads/form-submission volume — shown first (top of the researched hierarchy: leads > traffic > rankings/health). */
  leads?: {
    count: number;
    change_pct?: number | null; // vs. the prior comparable period, e.g. last month
    forms?: { name: string; count: number }[];
  };
  /** Traffic — shown second. */
  traffic?: {
    sessions: number;
    change_pct?: number | null;
    top_sources?: { source: string; sessions: number }[];
  };
  /** SEO rankings — shown third/last, alongside uptime. */
  rankings?: {
    avg_position?: number | null;
    tracked_keywords?: number;
    top3_count?: number;
  };
  /** Site uptime for the period, 0-100. */
  uptime_pct?: number | null;
}

const ingestSchema = z.object({
  site_id: z.string().uuid(),
  period: z.enum(['day', 'week', 'month']),
  captured_at: z.coerce.date(),
  source: z.string().min(1).max(100),
  payload: z.record(z.string(), z.unknown()),
});

// POST /api/cron/site-stats
// Machine-only ingest, gated by the CRON_SECRET shared secret (matches every other /api/cron/*
// route's auth pattern — x-cron-secret header, not the Oracle service-user Bearer-key pattern,
// since this is a simple periodic push rather than a durable per-caller identity).
// Idempotent: re-pushing the same site_id+period+captured_at upserts, it never duplicates.
export async function POST(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const providedSecret = request.headers.get('x-cron-secret');

    if (!cronSecret) {
      console.error('CRON_SECRET environment variable not set');
      return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
    }
    if (providedSecret !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const data = ingestSchema.parse(body);

    const site = await prisma.site.findFirst({
      where: { id: data.site_id, is_deleted: false },
      select: { id: true },
    });
    if (!site) {
      return NextResponse.json({ error: 'Unknown site_id' }, { status: 404 });
    }

    const snapshot = await prisma.siteStatsSnapshot.upsert({
      where: {
        site_id_period_captured_at: {
          site_id: data.site_id,
          period: data.period,
          captured_at: data.captured_at,
        },
      },
      create: {
        site_id: data.site_id,
        period: data.period,
        captured_at: data.captured_at,
        source: data.source,
        payload: data.payload as Prisma.InputJsonValue,
      },
      update: {
        source: data.source,
        payload: data.payload as Prisma.InputJsonValue,
      },
      select: { id: true, captured_at: true, period: true },
    });

    return NextResponse.json({ success: true, snapshot });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 });
    }
    console.error('Site stats ingest failed:', error);
    return NextResponse.json({ error: 'Ingest failed' }, { status: 500 });
  }
}
