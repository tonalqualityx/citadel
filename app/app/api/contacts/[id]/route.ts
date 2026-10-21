import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatClientContactResponse } from '@/lib/api/formatters';
import { revokeContactAccess } from '@/lib/services/client-auth';
import { deriveContactPortalFields, GRANTABLE_ROLES, PORTAL_GRANTABLE_PROJECT_WHERE } from '@/lib/portal/access';
import { logUpdate, logDelete, detectChanges } from '@/lib/services/activity';

const updateContactSchema = z.object({
  name: z.string().max(255).optional().nullable(),
  email: z.string().trim().email().max(255).optional(),
  role: z.string().max(100).optional().nullable(),
  can_initiate_work: z.boolean().optional(),
  portal_role: z.enum(['owner', 'member', 'viewer', 'none']).optional(),
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
      // Role is the source of truth; can_initiate_work is derived from it on every write.
      data: {
        ...data,
        ...deriveContactPortalFields(data, existing.portal_role),
        ...(email !== undefined ? { email } : {}),
      },
    });

    const changes = detectChanges(
      existing as unknown as Record<string, unknown>,
      contact as unknown as Record<string, unknown>,
      ['name', 'email', 'role', 'portal_role', 'can_initiate_work', 'is_primary', 'notes']
    );
    await logUpdate(auth.userId, 'client_contact', contact.id, contact.email, changes);

    // Portal role none ends portal access now: kill live sessions and unused login links.
    // Exception (spec: project-only contacts): a contact that still holds a project grant keeps
    // signing in and sees only the granted projects.
    // An email change also ends access: sessions and unused links are bound to the contact row
    // but resolve the person by email, so they would otherwise follow the new address to every
    // client it reaches. The person signs in again at the new address.
    const emailChanged = existing.email.trim().toLowerCase() !== contact.email.trim().toLowerCase();
    if (emailChanged) {
      await revokeContactAccess(contact.id);
    } else if (contact.portal_role === 'none') {
      const grants = await prisma.projectContact.count({
        where: {
          contact_id: contact.id,
          role: { in: [...GRANTABLE_ROLES] },
          project: PORTAL_GRANTABLE_PROJECT_WHERE,
        },
      });
      if (grants === 0) await revokeContactAccess(contact.id);
    }

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

    // Soft delete also drops the contact's project grants, so re-adding the same email later
    // starts clean instead of silently restoring old access.
    await prisma.$transaction([
      prisma.clientContact.update({ where: { id }, data: { is_deleted: true } }),
      prisma.projectContact.deleteMany({ where: { contact_id: id } }),
    ]);

    await revokeContactAccess(id);
    await logDelete(auth.userId, 'client_contact', id, existing.email);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
