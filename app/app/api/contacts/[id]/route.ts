import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatClientContactResponse } from '@/lib/api/formatters';
import { logUpdate, logDelete, detectChanges } from '@/lib/services/activity';

const updateContactSchema = z.object({
  name: z.string().max(255).optional().nullable(),
  email: z.string().trim().email().max(255).optional(),
  role: z.string().max(100).optional().nullable(),
  can_initiate_work: z.boolean().optional(),
  is_primary: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

// PATCH /api/contacts/[id] — update a contact
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const existing = await prisma.clientContact.findUnique({ where: { id } });
    if (!existing || existing.is_deleted) {
      throw new ApiError('Contact not found', 404);
    }

    const body = await request.json();
    const data = updateContactSchema.parse(body);
    const email = data.email !== undefined ? data.email.trim() : undefined;

    // Guard the (client, email) uniqueness when email changes
    if (email && email !== existing.email) {
      const clash = await prisma.clientContact.findUnique({
        where: { client_id_email: { client_id: existing.client_id, email } },
      });
      if (clash && !clash.is_deleted && clash.id !== id) {
        throw new ApiError('A contact with this email already exists for this client', 409);
      }
    }

    const contact = await prisma.clientContact.update({
      where: { id },
      data: { ...data, ...(email !== undefined ? { email } : {}) },
    });

    const changes = detectChanges(
      existing as unknown as Record<string, unknown>,
      contact as unknown as Record<string, unknown>,
      ['name', 'email', 'role', 'can_initiate_work', 'is_primary', 'notes']
    );
    await logUpdate(auth.userId, 'client_contact', contact.id, contact.email, changes);

    return NextResponse.json(formatClientContactResponse(contact));
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/contacts/[id] — soft delete a contact
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const existing = await prisma.clientContact.findUnique({ where: { id } });
    if (!existing || existing.is_deleted) {
      throw new ApiError('Contact not found', 404);
    }

    await prisma.clientContact.update({
      where: { id },
      data: { is_deleted: true },
    });

    await logDelete(auth.userId, 'client_contact', id, existing.email);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
