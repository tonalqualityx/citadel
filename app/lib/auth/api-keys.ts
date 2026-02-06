import crypto from 'crypto';

const API_KEY_PREFIX = 'citadel_';

export function generateApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const randomBytes = crypto.randomBytes(32);
  const rawKey = API_KEY_PREFIX + randomBytes.toString('hex');
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.substring(0, 16);

  return { rawKey, keyHash, keyPrefix };
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}
