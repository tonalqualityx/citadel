import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET || '';

export async function uploadToS3(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  if (!BUCKET_NAME) {
    throw new Error('AWS_S3_BUCKET environment variable is not set');
  }

  const key = `uploads/${filename}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  // Return the public URL
  return `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
}

export function isS3Configured(): boolean {
  return !!(
    process.env.AWS_S3_BUCKET &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
  );
}

/** Portal client files (phase C spec 6): stored with no public URL, read back only through the app. */
export const PRIVATE_PREFIX = 'portal-private/';
/** The public upload route writes under `uploads/` (and returns a public URL). Private objects never go there. */
export function assertPrivateKey(key: string): void {
  if (!key.startsWith(PRIVATE_PREFIX) || key.includes('..') || /^(?:uploads|public)\//.test(key)) {
    throw new Error('Private objects live under ' + PRIVATE_PREFIX);
  }
}

export async function putPrivateObject(key: string, buffer: Buffer, contentType: string): Promise<void> {
  assertPrivateKey(key);
  // No ACL on purpose: the object inherits the bucket's block on public access. Never 'public-read'.
  if (!BUCKET_NAME) throw new Error('AWS_S3_BUCKET environment variable is not set');
  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, Body: buffer, ContentType: contentType, ServerSideEncryption: 'AES256' }));
}

export async function getPrivateObject(key: string): Promise<Buffer> {
  assertPrivateKey(key);
  if (!BUCKET_NAME) throw new Error('AWS_S3_BUCKET environment variable is not set');
  const res = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error('Empty object');
  return Buffer.from(bytes);
}

/**
 * Run at deploy/rollout (see the C2 plan): writes one fixed probe object under the private prefix with the
 * app's credentials, then fetches it anonymously. Private means the anonymous request is refused (403/401).
 * A 200 means the bucket policy or ACL makes the private prefix readable by anyone: stop and fix the policy.
 * (A probe on a missing key proves nothing: a public-read bucket answers 403 for a key that does not exist.)
 */
export async function verifyPrivateNotPublic(
  deps: { fetchImpl?: typeof fetch; put?: (key: string, body: Buffer, type: string) => Promise<void> } = {}
): Promise<{ ok: boolean; status: number; url: string }> {
  if (!BUCKET_NAME) throw new Error('AWS_S3_BUCKET environment variable is not set');
  const key = PRIVATE_PREFIX + '__probe__/public-read-check.txt';
  await (deps.put ?? putPrivateObject)(key, Buffer.from('private'), 'text/plain');
  const url = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
  const res = await (deps.fetchImpl ?? fetch)(url, { method: 'GET', redirect: 'manual' });
  return { ok: res.status === 403 || res.status === 401, status: res.status, url };
}
