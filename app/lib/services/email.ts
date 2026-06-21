/**
 * Email Service
 *
 * Uses SendGrid when configured, falls back to console logging otherwise.
 */

import { prisma } from '@/lib/db/prisma';

interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

interface SendGridConfig {
  apiKey: string;
  fromEmail: string;
}

/**
 * Get SendGrid configuration from database
 */
async function getSendGridConfig(): Promise<SendGridConfig | null> {
  try {
    const integration = await prisma.integration.findUnique({
      where: { provider: 'sendgrid' },
    });

    if (!integration || !integration.is_active) {
      return null;
    }

    const config = integration.config as { apiKey?: string; fromEmail?: string };
    if (!config.apiKey || !config.fromEmail) {
      return null;
    }

    return {
      apiKey: config.apiKey,
      fromEmail: config.fromEmail,
    };
  } catch (error) {
    console.error('Failed to get SendGrid config:', error);
    return null;
  }
}

/**
 * Send email via SendGrid API
 */
async function sendViaSendGrid(
  config: SendGridConfig,
  options: SendEmailOptions
): Promise<boolean> {
  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: options.to }],
            subject: options.subject,
          },
        ],
        from: {
          email: config.fromEmail,
          name: 'Indelible',
        },
        content: [
          { type: 'text/plain', value: options.text },
          ...(options.html ? [{ type: 'text/html', value: options.html }] : []),
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('SendGrid API error:', response.status, errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('SendGrid request failed:', error);
    return false;
  }
}

/**
 * Log email to console (fallback when SendGrid not configured)
 */
function logToConsole(options: SendEmailOptions): void {
  console.log('========================================');
  console.log('EMAIL SERVICE - Message (Console Only)');
  console.log('========================================');
  console.log(`To: ${options.to}`);
  console.log(`Subject: ${options.subject}`);
  console.log('----------------------------------------');
  console.log(options.text);
  console.log('========================================');
}

/**
 * Send an email
 * Uses SendGrid if configured, otherwise logs to console
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const config = await getSendGridConfig();

  if (config) {
    const sent = await sendViaSendGrid(config, options);
    if (sent) {
      console.log(`Email sent via SendGrid to ${options.to}`);
      return;
    }
    // Fall through to console logging if SendGrid fails
    console.warn('SendGrid failed, falling back to console logging');
  }

  // Fallback: log to console
  logToConsole(options);
}

/**
 * Send the "work is ready for your review" email to a client requestor.
 *
 * Neutral, professional Indelible voice — never references the internal worker persona.
 * Includes the preview link (staging URL, when the work was staged) and the token-gated
 * approval page link so the recipient can review and approve in one place.
 */
export async function sendTaskApprovalRequestEmail(options: {
  to: string;
  approvalUrl: string;
  taskTitle: string;
  contactName?: string | null;
  stagingUrl?: string | null;
}): Promise<void> {
  const { to, approvalUrl, taskTitle, contactName, stagingUrl } = options;
  const greetingName = contactName ? ` ${contactName}` : '';

  const subject = `Ready for your review: ${taskTitle}`;

  const previewTextBlock = stagingUrl
    ? `You can preview the work here:\n${stagingUrl}\n\n`
    : '';

  const text = `
Hi${greetingName},

Your request "${taskTitle}" is ready for your review.

${previewTextBlock}When you're happy with it, you can review and approve using the link below:
${approvalUrl}

If you'd like any changes, you can request them from the same page.

Thank you,
The Indelible Team
`.trim();

  const previewHtmlBlock = stagingUrl
    ? `<p>You can preview the work here:</p>
    <p><a href="${stagingUrl}">${stagingUrl}</a></p>`
    : '';

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
    <h2>Ready for your review</h2>
    <p>Hi${greetingName},</p>
    <p>Your request "${taskTitle}" is ready for your review.</p>
    ${previewHtmlBlock}
    <p>When you're happy with it, you can review and approve below:</p>
    <p><a href="${approvalUrl}" class="button">Review &amp; Approve</a></p>
    <p>Or copy and paste this link into your browser:</p>
    <p><a href="${approvalUrl}">${approvalUrl}</a></p>
    <p>If you'd like any changes, you can request them from the same page.</p>
    <p class="footer">Thank you,<br>The Indelible Team</p>
  </div>
</body>
</html>
`.trim();

  await sendEmail({ to, subject, text, html });
}

/**
 * Send a password reset email
 */
export async function sendPasswordResetEmail(
  email: string,
  resetToken: string,
  userName?: string
): Promise<void> {
  // Build reset URL
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;

  const subject = 'Reset your Indelible password';
  const text = `
Hi${userName ? ` ${userName}` : ''},

You requested to reset your password for your Indelible account.

Click the link below to reset your password:
${resetUrl}

This link will expire in 1 hour.

If you didn't request this, you can safely ignore this email.

- The Indelible Team
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
    <h2>Reset your password</h2>
    <p>Hi${userName ? ` ${userName}` : ''},</p>
    <p>You requested to reset your password for your Indelible account.</p>
    <p><a href="${resetUrl}" class="button">Reset Password</a></p>
    <p>Or copy and paste this link into your browser:</p>
    <p><a href="${resetUrl}">${resetUrl}</a></p>
    <p>This link will expire in 1 hour.</p>
    <p class="footer">If you didn't request this, you can safely ignore this email.</p>
    <p class="footer">- The Indelible Team</p>
  </div>
</body>
</html>
`.trim();

  await sendEmail({ to: email, subject, text, html });
}
