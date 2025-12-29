/**
 * Email Service
 *
 * For MVP: Logs emails to console instead of sending them.
 * TODO: Integrate with a real email provider (Resend, SendGrid, etc.)
 */

interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Send an email (or log it in development/MVP)
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  // TODO: Replace with real email sending when integrating email provider
  // Example with Resend:
  // const resend = new Resend(process.env.RESEND_API_KEY);
  // await resend.emails.send({
  //   from: 'noreply@indelible.app',
  //   to: options.to,
  //   subject: options.subject,
  //   text: options.text,
  //   html: options.html,
  // });

  // For MVP: Log to console
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
