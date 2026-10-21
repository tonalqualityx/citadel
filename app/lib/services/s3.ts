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
export async function putPrivateObject(key: string, buffer: Buffer, contentType: string): Promise<void> {
  if (!BUCKET_NAME) throw new Error('AWS_S3_BUCKET environment variable is not set');
  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, Body: buffer, ContentType: contentType, ServerSideEncryption: 'AES256' }));
}

export async function getPrivateObject(key: string): Promise<Buffer> {
  if (!BUCKET_NAME) throw new Error('AWS_S3_BUCKET environment variable is not set');
  const res = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error('Empty object');
  return Buffer.from(bytes);
}
