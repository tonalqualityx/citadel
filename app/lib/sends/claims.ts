/**
 * Notice claims (Fleet item 4): "the client was told this fact", kept as tags on the task. A leaf module
 * (it imports only prisma) so lib/services/portal.ts can clear claims without an import cycle.
 */
import { createHash, randomBytes } from 'crypto';
import { prisma } from '@/lib/db/prisma';

export const GO_LIVE_TAG = 'go-live-notified';
export const PREVIEW_TAG_PREFIX = 'preview-notified:';

/** The tag a preview notice claims: one per distinct preview address. */
export const previewTag = (url: string) => `${PREVIEW_TAG_PREFIX}${createHash('sha1').update(url).digest('hex').slice(0, 10)}`;

/** tasks.tags is varchar(50)[]: keep the holder tag short. `cl:<holder>` for live, `cp:<url hash>:<holder>` for a preview. */
const holderTag = (tag: string, holder: string) => (tag === GO_LIVE_TAG ? `cl:${holder}` : `cp:${tag.slice(PREVIEW_TAG_PREFIX.length)}:${holder}`);

/**
 * Claim "the client was told this fact" in one UPDATE. Returns a holder id for the first caller and null for
 * every later one, on any channel (null means do not send). The id is stored beside the tag and is required to
 * release the claim, so only the caller that took it can give it back. `live` claims go-live-notified;
 * `preview` claims preview-notified:<sha1(url)[0:10]>.
 */
export async function claimNotice(taskId: string, kind: 'live' | 'preview', previewUrl?: string | null): Promise<string | null> {
  if (kind === 'preview' && !previewUrl) throw new Error('claimNotice preview needs the preview url');
  const tag = kind === 'live' ? GO_LIVE_TAG : previewTag(previewUrl as string);
  const holder = randomBytes(6).toString('hex');
  const both = [tag, holderTag(tag, holder)];
  const n = await prisma.$executeRaw`UPDATE tasks SET tags = tags || ${both}::text[] WHERE id = ${taskId}::uuid AND NOT (${tag} = ANY(tags))`;
  return n === 1 ? holder : null;
}

/**
 * Give a claim back (the send it guarded did not go out). Needs the holder id claimNotice returned; a claim
 * held by someone else is left alone. True when the claim was released.
 */
export async function releaseNotice(taskId: string, kind: 'live' | 'preview', previewUrl: string | null | undefined, holder: string | null | undefined): Promise<boolean> {
  if (kind === 'preview' && !previewUrl) throw new Error('releaseNotice preview needs the preview url');
  if (!holder) return false;
  const tag = kind === 'live' ? GO_LIVE_TAG : previewTag(previewUrl as string);
  const ht = holderTag(tag, holder);
  const n = await prisma.$executeRaw`UPDATE tasks SET tags = array_remove(array_remove(tags, ${tag}), ${ht}) WHERE id = ${taskId}::uuid AND ${ht} = ANY(tags)`;
  return n === 1;
}

/** A task left review for rework: every preview notice claim on it is spent, so a revised preview (even at the same address) is told afresh. */
export async function clearPreviewClaims(taskId: string): Promise<void> {
  await prisma.$executeRaw`UPDATE tasks SET tags = ARRAY(SELECT t FROM unnest(tags) AS t WHERE t NOT LIKE 'preview-notified:%' AND t NOT LIKE 'cp:%') WHERE id = ${taskId}::uuid AND EXISTS (SELECT 1 FROM unnest(tags) AS t WHERE t LIKE 'preview-notified:%')`;
}
