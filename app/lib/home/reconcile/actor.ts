/**
 * Home Slice 9a: the auth payload the owner's own card tap uses for patchTask (the same task write his browser PATCH runs).
 * It is built from the user row, never from a request, and only inside code that already checked it is his own tap
 * (the session-only route, or his own instruction through the chat's home op).
 */
import type { PrismaClient } from '@prisma/client';
import type { AuthPayload } from '@/lib/auth/middleware';
import { ReconcileError } from './errors';

export async function ownerActor(db: PrismaClient, userId: string): Promise<AuthPayload> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, is_active: true } });
  if (!u || !u.is_active) throw new ReconcileError('not_found');
  return { userId: u.id, email: u.email, role: u.role, via: 'session' } as AuthPayload;
}
