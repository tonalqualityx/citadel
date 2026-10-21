/**
 * Private storage for portal client files (phase C spec 6). S3 key `portal-private/{client}/{id}`
 * with no public URL when S3 is configured; otherwise PORTAL_UPLOAD_DIR (default
 * /var/www/citadel/portal-uploads, outside the deploy path), never under public/.
 */
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { getPrivateObject, isS3Configured, putPrivateObject } from '@/lib/services/s3';

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9/_-]*$/;

export function uploadDir(): string {
  return resolve(process.env.PORTAL_UPLOAD_DIR || '/var/www/citadel/portal-uploads');
}

export const storageKey = (clientId: string, attachmentId: string) => `portal-private/${clientId}/${attachmentId}`;

function localPath(key: string): string {
  if (!KEY_RE.test(key) || key.includes('..')) throw new Error('Bad storage key');
  const base = uploadDir();
  const full = resolve(join(base, key));
  if (!full.startsWith(base + '/')) throw new Error('Bad storage key');
  return full;
}

export async function putPrivate(key: string, buf: Buffer, contentType: string): Promise<void> {
  if (isS3Configured()) return putPrivateObject(key, buf, contentType);
  const path = localPath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf, { mode: 0o600 });
}

export async function getPrivate(key: string): Promise<Buffer> {
  if (isS3Configured()) return getPrivateObject(key);
  return readFile(localPath(key));
}
