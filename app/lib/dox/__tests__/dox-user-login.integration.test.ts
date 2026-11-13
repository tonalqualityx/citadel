// @vitest-environment node
import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { DOX_USER_ID, DOX_SERVICE_EMAIL } from '@/lib/dox/identity';
import { BOT_USER_IDS as ORACLE_BOTS } from '@/lib/oracle/projects/gate-constants';
import { BOT_USER_IDS as MIRROR_BOTS } from '@/lib/bast-chat/gate-mirror';

const MIGRATION = path.resolve(__dirname, '../../../prisma/migrations/20261121090000_dox_user/migration.sql');
const MARKER = 'NO-PASSWORD-LOGIN:dox-service-user';

const login = (password: string, ip: string) =>
  loginRoute(
    new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ email: DOX_SERVICE_EMAIL, password }),
    }),
  );

describe('Dox user: no password can sign him in (marker is not a bcrypt hash)', () => {
  it('the migration inserts the fixed id and email with a non-bcrypt marker, idempotently', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain(DOX_USER_ID);
    expect(sql).toContain(DOX_SERVICE_EMAIL);
    expect(sql).toContain(MARKER);
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/);
  });

  it('bcrypt.compare fails closed on the marker, for the marker itself and for ordinary guesses', async () => {
    expect(MARKER).not.toMatch(/^\$2[abxy]\$/);
    for (const guess of [MARKER, 'password', 'dox', 'x'.repeat(72)]) {
      expect(await bcrypt.compare(guess, MARKER)).toBe(false);
    }
  });

  it('Dox is in both bot lists, once', () => {
    expect(ORACLE_BOTS.filter((i) => i === DOX_USER_ID)).toHaveLength(1);
    expect(MIRROR_BOTS.filter((i) => i === DOX_USER_ID)).toHaveLength(1);
  });
});

describe.skipIf(!SCRATCH)('Dox user: the login route refuses him (real database, migration applied)', () => {
  it('the migrated row exists with the marker hash, role pm, active, and the avatar url', async () => {
    const u = await prisma.user.findUnique({ where: { id: DOX_USER_ID } });
    expect(u).not.toBeNull();
    expect(u!.email).toBe(DOX_SERVICE_EMAIL);
    expect(u!.name).toBe('Dox');
    expect(u!.role).toBe('pm');
    expect(u!.password_hash).toBe(MARKER);
    expect(u!.avatar_url).toBe('https://citadel.becomeindelible.com/avatars/dox-512.jpg');
  });

  it('POST /api/auth/login answers 401 and sets no cookie, whatever the password', async () => {
    let n = 0;
    for (const pw of [MARKER, 'password', 'dox', DOX_USER_ID]) {
      const res = await login(pw, `10.9.${++n}.1`);
      expect(res.status).toBe(401);
      expect(res.headers.getSetCookie()).toHaveLength(0);
    }
    expect(await prisma.session.count({ where: { user_id: DOX_USER_ID } })).toBe(0);
    expect((await prisma.user.findUnique({ where: { id: DOX_USER_ID } }))!.last_login_at).toBeNull();
  });
});
