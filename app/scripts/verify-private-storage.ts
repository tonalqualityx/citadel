/**
 * Rollout check for portal client files (phase C spec 6, plan "Bucket policy check"): proves the
 * private prefix of the REAL bucket is not publicly readable. It writes one fixed probe object under
 * `portal-private/__probe__/` with the app's credentials, then fetches it anonymously. Private means the
 * anonymous request is refused (403 or 401). A 200 means the bucket policy or an ACL makes client files
 * readable by anyone: stop and fix the policy before turning chat on.
 *
 *   AWS_S3_BUCKET=... AWS_REGION=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
 *     npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/verify-private-storage.ts
 *
 * Exit 0 = private, 1 = readable (or the probe was not refused), 2 = not configured / could not run.
 * It writes only that one probe object, overwritten on every run. It never reads or lists client files.
 */
import { isS3Configured, verifyPrivateNotPublic } from '../lib/services/s3';

async function main(): Promise<number> {
  if (!isS3Configured()) {
    console.error('AWS_S3_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set. Nothing was checked.');
    return 2;
  }
  try {
    const res = await verifyPrivateNotPublic();
    if (res.ok) {
      console.log(`PRIVATE: an anonymous fetch of the probe was refused (HTTP ${res.status}).`);
      return 0;
    }
    console.error(`NOT PRIVATE: an anonymous fetch of ${res.url} returned HTTP ${res.status}, not 403 or 401. Fix the bucket policy before enabling chat.`);
    return 1;
  } catch (error) {
    console.error('Could not run the check:', error instanceof Error ? error.message : error);
    return 2;
  }
}

main().then((code) => process.exit(code));
