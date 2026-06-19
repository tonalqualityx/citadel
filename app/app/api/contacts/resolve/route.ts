import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

/**
 * GET /api/contacts/resolve?email=<addr>
 *
 * Resolves a raw sender email to the client(s) it is an authorized contact for, with
 * enough per-site context for the email-check skill to decide WHICH site an email is about
 * (from the email's content, never the sender's domain) and how to route the work.
 *
 * Match is case-insensitive on the trimmed email. Soft-deleted contacts/clients/sites are excluded.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAuth();

    const { searchParams } = new URL(request.url);
    const email = (searchParams.get('email') || '').trim();
    if (!email) {
      throw new ApiError('email query parameter is required', 400);
    }

    const contacts = await prisma.clientContact.findMany({
      where: {
        is_deleted: false,
        email: { equals: email, mode: 'insensitive' },
        client: { is_deleted: false },
      },
      include: {
        client: {
          include: {
            sites: {
              where: { is_deleted: false },
              include: {
                domains: {
                  where: { is_deleted: false },
                  select: { name: true },
                },
              },
              orderBy: { name: 'asc' },
            },
          },
        },
      },
    });

    const matches = contacts.map((contact) => ({
      contact_id: contact.id,
      name: contact.name,
      role: contact.role,
      can_initiate_work: contact.can_initiate_work,
      is_primary: contact.is_primary,
      client: {
        id: contact.client.id,
        name: contact.client.name,
        type: contact.client.type,
        status: contact.client.status,
      },
      sites: contact.client.sites.map((site) => ({
        id: site.id,
        name: site.name,
        url: site.url,
        site_type: site.site_type,
        domains: site.domains.map((d) => d.name),
        notes: site.notes,
      })),
    }));

    return NextResponse.json({ email, matches });
  } catch (error) {
    return handleApiError(error);
  }
}
