import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatClientContactResponse } from '@/lib/api/formatters';
import { logCreate } from '@/lib/services/activity';

const createContactSchema = z.object({
  name: z.string().max(255).optional().nullable(),
  email: z.string().trim().email().max(255),
  role: z.string().max(100).optional().nullable(),
  can_initiate_work: z.boolean().optional(),
  is_primary: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

// GET /api/clients/[id]/contacts — list a client's contacts
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const client = await prisma.client.findUnique({
      where: { id, is_deleted: false },
      select: { id: true },
    });
    if (!client) {
      throw new ApiError('Client not found', 404);
    }

    const contacts = await prisma.clientContact.findMany({
      where: { client_id: id, is_deleted: false },
      orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
    });

    return NextResponse.json({ contacts: contacts.map(formatClientContactResponse) });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/clients/[id]/contacts — add a contact to a client
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const client = await prisma.client.findUnique({
      where: { id, is_deleted: false },
      select: { id: true },
    });
    if (!client) {
      throw new ApiError('Client not found', 404);
    }

    const body = await request.json();
    const data = createContactSchema.parse(body);
    const email = data.email.trim();

    // Enforce one row per (client, email), accounting for soft-deleted rows
    const existing = await prisma.clientContact.findUnique({
      where: { client_id_email: { client_id: id, email } },
    });
    if (existing && !existing.is_deleted) {
      throw new ApiError('A contact with this email already exists for this client', 409);
    }

    const contact = existing
      ? await prisma.clientContact.update({
          where: { id: existing.id },
          data: {
            name: data.name ?? null,
            role: data.role ?? null,
            can_initiate_work: data.can_initiate_work ?? false,
            is_primary: data.is_primary ?? false,
            notes: data.notes ?? null,
            is_deleted: false,
          },
        })
      : await prisma.clientContact.create({
          data: {
            client_id: id,
            name: data.name ?? null,
            email,
            role: data.role ?? null,
            can_initiate_work: data.can_initiate_work ?? false,
            is_primary: data.is_primary ?? false,
            notes: data.notes ?? null,
          },
        });

    await logCreate(auth.userId, 'client_contact', contact.id, contact.email);

    return NextResponse.json(formatClientContactResponse(contact), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
