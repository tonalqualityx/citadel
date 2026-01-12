import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const VALID_PROVIDERS = ['sendgrid', 'quickbooks', 'claude', 'slack'] as const;

interface IntegrationConfig {
  apiKey?: string;
  fromEmail?: string;
  botToken?: string;
  signingSecret?: string;
  [key: string]: unknown;
}

const sendGridConfigSchema = z.object({
  apiKey: z.string().min(1, 'API key is required').optional(),
  fromEmail: z.string().email('Invalid email address'),
});

const slackConfigSchema = z.object({
  botToken: z.string().min(1, 'Bot token is required').optional(),
  signingSecret: z.string().min(1, 'Signing secret is required').optional(),
  appId: z.string().optional(),
  teamId: z.string().optional(),
  teamName: z.string().optional(),
  setupComplete: z.boolean().optional(),
});

function maskApiKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (key.length <= 8) return '****';
  return `****${key.slice(-4)}`;
}

function maskConfig(config: IntegrationConfig): IntegrationConfig {
  const masked = { ...config };
  if (masked.apiKey) {
    masked.apiKey = maskApiKey(masked.apiKey);
  }
  if (masked.botToken) {
    masked.botToken = maskApiKey(masked.botToken);
  }
  if (masked.signingSecret) {
    masked.signingSecret = maskApiKey(masked.signingSecret);
  }
  return masked;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { provider } = await params;

    if (!VALID_PROVIDERS.includes(provider as typeof VALID_PROVIDERS[number])) {
      throw new ApiError('Invalid provider', 400);
    }

    const integration = await prisma.integration.findUnique({
      where: { provider },
    });

    if (!integration) {
      // Return empty config for unconfigured integrations
      return NextResponse.json({
        provider,
        config: {},
        is_active: false,
      });
    }

    return NextResponse.json({
      ...integration,
      config: maskConfig(integration.config as IntegrationConfig),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { provider } = await params;

    if (!VALID_PROVIDERS.includes(provider as typeof VALID_PROVIDERS[number])) {
      throw new ApiError('Invalid provider', 400);
    }

    const body = await request.json();

    // Validate config based on provider
    let validatedConfig: IntegrationConfig;
    if (provider === 'sendgrid') {
      validatedConfig = sendGridConfigSchema.parse(body.config);
    } else if (provider === 'slack') {
      validatedConfig = slackConfigSchema.parse(body.config);
    } else {
      // Other providers not yet implemented
      throw new ApiError('Provider not yet supported', 400);
    }

    // Get existing integration to merge config
    const existing = await prisma.integration.findUnique({
      where: { provider },
    });

    // Merge with existing config (keep existing secrets if not provided)
    let finalConfig = validatedConfig;
    if (existing) {
      const existingConfig = existing.config as IntegrationConfig;

      if (provider === 'sendgrid' && !validatedConfig.apiKey) {
        finalConfig = { ...validatedConfig, apiKey: existingConfig.apiKey };
      } else if (provider === 'slack') {
        if (!validatedConfig.botToken) {
          finalConfig.botToken = existingConfig.botToken;
        }
        if (!validatedConfig.signingSecret) {
          finalConfig.signingSecret = existingConfig.signingSecret;
        }
      }
    }

    // Require secrets for new integrations
    if (!existing) {
      if (provider === 'sendgrid' && !finalConfig.apiKey) {
        throw new ApiError('API key is required', 400);
      }
      if (provider === 'slack' && (!finalConfig.botToken || !finalConfig.signingSecret)) {
        throw new ApiError('Bot token and signing secret are required', 400);
      }
    }

    // Upsert the integration
    const integration = await prisma.integration.upsert({
      where: { provider },
      create: {
        id: crypto.randomUUID(),
        provider,
        config: finalConfig as object,
        is_active: true,
        updated_by: auth.userId,
      },
      update: {
        config: finalConfig as object,
        is_active: true,
        updated_by: auth.userId,
      },
    });

    return NextResponse.json({
      ...integration,
      config: maskConfig(integration.config as IntegrationConfig),
    });
  } catch (error) {
    console.error('Integration update error:', error);
    return handleApiError(error);
  }
}
