import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { isLeaseActive } from '@/lib/troubador/helpers';
import { getRunwayReport } from '@/lib/services/troubador-runway';

// Stages beyond research where an article is considered "researched or beyond".
const RESEARCHED_OR_BEYOND = new Set([
  'researched',
  'drafting',
  'in_review',
  'needs_revision',
  'approved',
  'scheduled',
  'published',
  'postponed',
]);

export async function GET() {
  try {
    await requireAuth();

    const runs = await prisma.troubadorRun.findMany({
      where: {
        is_deleted: false,
        stage: { in: ['planning', 'topic_selection', 'researching', 'in_production', 'publishing'] },
      },
      include: {
        client: { select: { id: true, name: true } },
        site: { select: { id: true, name: true, site_type: true } },
        articles: { where: { is_deleted: false } },
      },
    });

    const now = new Date();
    type Item = Record<string, unknown> & { urgency_date: Date | null };
    const items: Item[] = [];

    for (const run of runs) {
      const base = {
        run_id: run.id,
        run_stage: run.stage,
        client: run.client,
        site: run.site,
      };

      if (run.stage === 'planning') {
        if (run.ready && !isLeaseActive(run.claimed_at)) {
          items.push({ action: 'generate_proposals', ...base, urgency_date: run.updated_at });
        }
      } else if (run.stage === 'topic_selection') {
        if (run.selection_ready) {
          items.push({ action: 'create_articles', ...base, urgency_date: run.updated_at });
        }
      } else if (run.stage === 'researching') {
        for (const a of run.articles) {
          if (a.status === 'pending_research' && !isLeaseActive(a.claimed_at)) {
            items.push({
              action: 'research_article',
              ...base,
              article_id: a.id,
              article_slug: a.slug,
              urgency_date: run.updated_at,
            });
          }
        }
        const nonDropped = run.articles.filter((a) => a.status !== 'dropped');
        if (
          nonDropped.length > 0 &&
          nonDropped.every((a) => RESEARCHED_OR_BEYOND.has(a.status))
        ) {
          items.push({ action: 'post_interview_questions', ...base, urgency_date: run.updated_at });
        }
      } else if (run.stage === 'in_production' || run.stage === 'publishing') {
        // Once every live article is approved/scheduled the run flips to `publishing`
        // (see recomputeProductionStage), so the publish checks must cover BOTH stages —
        // otherwise approved copy is invisible to the worker and nothing ever publishes.
        for (const a of run.articles) {
          if (a.status === 'researched' && !isLeaseActive(a.claimed_at)) {
            items.push({
              action: 'draft_article',
              ...base,
              article_id: a.id,
              article_slug: a.slug,
              urgency_date: run.updated_at,
            });
          } else if (a.status === 'needs_revision' && !isLeaseActive(a.claimed_at)) {
            items.push({
              action: 'rewrite_article',
              ...base,
              article_id: a.id,
              article_slug: a.slug,
              urgency_date: run.updated_at,
            });
          } else if (
            (a.status === 'approved' || (a.status === 'scheduled' && !a.scheduled_date)) &&
            !isLeaseActive(a.claimed_at)
          ) {
            // Approved copy is ready to publish now (no future scheduling requested).
            // A `scheduled` article whose date has been cleared belongs here too:
            // it has no future date left to wait for, and the dated branch below
            // requires a non-null date, so without this it would never surface
            // again. The article PATCH route no longer creates that state, but
            // rows stranded by the old behaviour still need a way back in.
            items.push({
              action: 'publish_article',
              ...base,
              article_id: a.id,
              article_slug: a.slug,
              urgency_date: run.updated_at,
            });
          } else if (
            a.status === 'scheduled' &&
            a.scheduled_date &&
            new Date(a.scheduled_date) <= now &&
            !isLeaseActive(a.claimed_at)
          ) {
            // Future-dated copy becomes publishable once its scheduled date arrives.
            items.push({
              action: 'publish_article',
              ...base,
              article_id: a.id,
              article_slug: a.slug,
              urgency_date: run.updated_at,
            });
          }
        }
      }
    }

    // Content runway. The scan above is run-driven, so a site whose every run has reached
    // `done` contributes nothing to it — which is exactly what an exhausted site looks like.
    // The runway report is site-driven and catches that case. Two suppressions keep this from
    // becoming a standing item the worker refiles every tick: a site already running a live cycle
    // is being re-evaluated already, and a site whose alarm task is still open has had its ask
    // raised. Both clear on their own — the run finishes, or a human closes the task.
    const runwayReport = await getRunwayReport(now);
    for (const alarm of runwayReport.alarms) {
      if (alarm.runway.has_live_run || alarm.runway.has_open_alarm_task) continue;
      items.push({
        action: 'reevaluate_topics',
        run_id: null,
        run_stage: null,
        client: { id: alarm.runway.client_id, name: alarm.runway.client_name },
        site: { id: alarm.runway.site_id, name: alarm.runway.site_name },
        article_id: null,
        article_slug: null,
        runway: alarm.runway,
        meeting_request_draft: alarm.meeting_request_draft,
        // Sorted by the day the shelf empties: the closer a site is to running dry, the
        // higher it climbs.
        urgency_date: new Date(`${alarm.runway.runway_end}T00:00:00Z`),
      });
    }

    items.sort((x, y) => {
      if (!x.urgency_date && !y.urgency_date) return 0;
      if (!x.urgency_date) return 1;
      if (!y.urgency_date) return -1;
      return new Date(x.urgency_date).getTime() - new Date(y.urgency_date).getTime();
    });

    return NextResponse.json({
      items,
      count: items.length,
      runway: {
        low_runway_count: runwayReport.alarms.length,
        sites: runwayReport.sites,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
