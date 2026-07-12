/**
 * Client review reminder emails
 *
 * A throttled, opt-in nudge to the client when an article has been sitting in
 * `staleClientReview` for a while — separate from the internal "needs-attention"
 * digest, because this one emails the CLIENT, not Mike.
 *
 * OFF by default. Mike is not yet ready to auto-email clients about a stale review,
 * so this only sends when CLIENT_REVIEW_REMINDERS_ENABLED === 'true'. Throttled to at
 * most one reminder per article per REMINDER_THROTTLE_DAYS, tracked via a
 * `review_reminder` PortalSession row (mirrors how magic-link/session rows already
 * live on that table).
 */

import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/services/email';

const REMINDER_THROTTLE_DAYS = 5;
const REMINDER_TOKEN_TYPE = 'review_reminder';

function isEnabled(): boolean {
  return process.env.CLIENT_REVIEW_REMINDERS_ENABLED === 'true';
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://citadel.becomeindelible.com';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function wasRecentlyReminded(articleId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - REMINDER_THROTTLE_DAYS * 24 * 60 * 60 * 1000);
  const recent = await prisma.portalSession.findFirst({
    where: {
      token_type: REMINDER_TOKEN_TYPE,
      entity_id: articleId,
      created_at: { gte: cutoff },
    },
    select: { id: true },
  });
  return !!recent;
}

async function recordReminderSent(articleId: string): Promise<void> {
  await prisma.portalSession.create({
    data: {
      token_type: REMINDER_TOKEN_TYPE,
      entity_id: articleId,
      ip_address: '0.0.0.0',
      user_agent: null,
      action: 'sent',
    },
  });
}

/** Resolve who gets the reminder: the client's primary contact, else the Client's own email. */
async function resolveRecipient(
  clientId: string
): Promise<{ email: string; name: string | null } | null> {
  const primary = await prisma.clientContact.findFirst({
    where: { client_id: clientId, is_primary: true, is_deleted: false },
    select: { email: true, name: true },
  });
  if (primary) return primary;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { email: true, name: true },
  });
  if (client?.email) return { email: client.email, name: client.name };

  return null;
}

async function sendReminderEmail(recipient: { email: string; name: string | null }, articleTitle: string) {
  const greeting = recipient.name ? ` ${recipient.name}` : '';
  const loginUrl = `${getAppUrl()}/portal/login`;
  const subject = `Awaiting your review: ${articleTitle}`;

  const text = `
Hi${greeting},

"${articleTitle}" is still waiting on your review in the Indelible client portal.

You can sign in here to take a look:
${loginUrl}

Thank you,
The Indelible Team
`.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #2D2D2D; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .button { display: inline-block; background: #5B8FB9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
    .footer { margin-top: 30px; color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Awaiting your review</h2>
    <p>Hi${greeting},</p>
    <p>"${escapeHtml(articleTitle)}" is still waiting on your review in the Indelible client portal.</p>
    <p><a href="${loginUrl}" class="button">Sign In</a></p>
    <p>Or copy and paste this link into your browser:</p>
    <p><a href="${loginUrl}">${loginUrl}</a></p>
    <p class="footer">Thank you,<br>The Indelible Team</p>
  </div>
</body>
</html>
`.trim();

  await sendEmail({ to: recipient.email, subject, text, html });
}

/**
 * Send (throttled) reminder emails for the given article ids. No-op unless
 * CLIENT_REVIEW_REMINDERS_ENABLED === 'true'. Never throws — callers (the digest)
 * must never have a reminder failure break the digest send.
 */
export async function sendClientReviewReminders(
  articleIds: string[]
): Promise<{ sent: number; skipped: number }> {
  if (!isEnabled() || articleIds.length === 0) {
    return { sent: 0, skipped: articleIds.length };
  }

  const articles = await prisma.article.findMany({
    where: { id: { in: articleIds } },
    select: { id: true, title: true, client_id: true },
  });

  let sent = 0;
  let skipped = 0;

  for (const article of articles) {
    try {
      if (await wasRecentlyReminded(article.id)) {
        skipped++;
        continue;
      }

      const recipient = await resolveRecipient(article.client_id);
      if (!recipient) {
        skipped++;
        continue;
      }

      await sendReminderEmail(recipient, article.title);
      await recordReminderSent(article.id);
      sent++;
    } catch (error) {
      console.error('sendClientReviewReminders: failed for article', article.id, error);
      skipped++;
    }
  }

  return { sent, skipped };
}
