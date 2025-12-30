import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const testConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  fromEmail: z.string().email('Invalid from email'),
  toEmail: z.string().email('Invalid recipient email'),
});

interface IntegrationConfig {
  apiKey?: string;
  fromEmail?: string;
}

export async function POST(request: NextRequest) {
  try {
    console.log('SendGrid test: Starting auth check');
    const auth = await requireAuth();
    console.log('SendGrid test: Auth passed, user:', auth.userId, 'role:', auth.role);
    requireRole(auth, ['admin']);
    console.log('SendGrid test: Role check passed');

    const body = await request.json();
    const { apiKey: providedApiKey, fromEmail, toEmail } = testConfigSchema.parse(body);

    // Use provided API key, or fall back to saved one
    let apiKey = providedApiKey;
    if (!apiKey) {
      const integration = await prisma.integration.findUnique({
        where: { provider: 'sendgrid' },
      });
      const config = integration?.config as IntegrationConfig | undefined;
      apiKey = config?.apiKey;
    }

    if (!apiKey) {
      throw new ApiError('No API key provided and none saved', 400);
    }

    // Try to send a test email using SendGrid API
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: toEmail }],
            subject: 'Indelible - SendGrid Test Email',
          },
        ],
        from: {
          email: fromEmail,
          name: 'Indelible',
        },
        content: [
          {
            type: 'text/html',
            value: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #2d2d2d;">SendGrid Integration Test</h2>
                <p>This is a test email from your Indelible application.</p>
                <p>If you received this email, your SendGrid integration is configured correctly!</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
                <p style="color: #666; font-size: 12px;">
                  Sent from Indelible at ${new Date().toLocaleString()}
                </p>
              </div>
            `,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.errors?.[0]?.message || 'Failed to send test email';
      // Use 400 instead of passing through SendGrid's status code
      // to avoid 401 being interpreted as session expiry
      throw new ApiError(`SendGrid error: ${errorMessage}`, 400);
    }

    return NextResponse.json({
      success: true,
      message: `Test email sent to ${toEmail}`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
