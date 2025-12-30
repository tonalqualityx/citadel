import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

interface IntegrationConfig {
  apiKey?: string;
  fromEmail?: string;
  [key: string]: unknown;
}

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
  return masked;
}

export async function GET() {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const integrations = await prisma.integration.findMany({
      orderBy: { provider: 'asc' },
    });

    // Mask API keys in responses
    const maskedIntegrations = integrations.map((integration) => ({
      ...integration,
      config: maskConfig(integration.config as IntegrationConfig),
    }));

    return NextResponse.json({ integrations: maskedIntegrations });
  } catch (error) {
    return handleApiError(error);
  }
}
