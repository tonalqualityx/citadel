// @vitest-environment node
/**
 * Secret drop pieces that need no database: link signing, who may use drops, the status of a drop, the envelope and origin checks, and the page
 * Mike opens (every state, escaping, the script nonce, and no public key once the drop is spent).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { BAST_USER_ID, MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { dropToken, envelopeSchema, mayUseDrops, mintSchema, postOriginAllowed, statusOf, verifyDropToken, type PublicView } from '../drops';
import { dropPage, pageHeaders } from '../page';

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-drops';
});

const ID = '0f36c806-90de-4a2c-914c-d32c191898ce';
const N = 'A'.repeat(342);

describe('drop tokens', () => {
  it('round trips and refuses an altered token', () => {
    const t = dropToken(ID);
    expect(verifyDropToken(t)).toBe(ID);
    const flipped = t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A');
    expect(verifyDropToken(flipped)).toBeNull();
    expect(verifyDropToken(`${ID.replace('0f', '1f')}.${t.split('.')[1]}`)).toBeNull();
    expect(verifyDropToken('nonsense')).toBeNull();
  });

  it('never matches an answer-link signature for the same id', async () => {
    const { tokenFor } = await import('@/lib/tasks/answer-links');
    expect(tokenFor(ID)).not.toBe(dropToken(ID));
    expect(verifyDropToken(tokenFor(ID))).toBeNull();
  });
});

describe('who may use drops', () => {
  it('Mike and the Bast worker key only', () => {
    expect(mayUseDrops({ userId: MIKE_USER_ID, via: 'session' })).toBe(true);
    expect(mayUseDrops({ userId: BAST_USER_ID, via: 'api_key', lane: 'bast' })).toBe(true);
    expect(mayUseDrops({ userId: BAST_USER_ID, via: 'api_key' })).toBe(true);
    expect(mayUseDrops({ userId: BAST_USER_ID, via: 'api_key', lane: 'bast-chat' })).toBe(false);
    expect(mayUseDrops({ userId: BAST_USER_ID, via: 'api_key', lane: 'triage-desk' })).toBe(false);
    expect(mayUseDrops({ userId: '1797579d-2c5e-42de-8366-c38be92ee1ae', via: 'api_key', lane: 'dox' })).toBe(false);
    expect(mayUseDrops({ userId: 'b565b492-cdea-497b-a13d-85f003916bf9', via: 'session' })).toBe(false);
  });
});

describe('status of a drop', () => {
  const now = new Date('2026-11-27T12:00:00Z');
  const later = new Date('2026-11-27T13:00:00Z');
  const earlier = new Date('2026-11-27T11:00:00Z');
  it('reads stored, failed, received, waiting and expired', () => {
    expect(statusOf({ submitted_at: earlier, stored_at: now, failed_at: null, expires_at: earlier }, now)).toBe('stored');
    expect(statusOf({ submitted_at: earlier, stored_at: null, failed_at: now, expires_at: later }, now)).toBe('failed');
    // a key that arrived before the link expired is still collected after it
    expect(statusOf({ submitted_at: earlier, stored_at: null, failed_at: null, expires_at: earlier }, now)).toBe('received');
    expect(statusOf({ submitted_at: null, stored_at: null, failed_at: null, expires_at: later }, now)).toBe('waiting');
    expect(statusOf({ submitted_at: null, stored_at: null, failed_at: null, expires_at: earlier }, now)).toBe('expired');
  });
});

describe('shapes', () => {
  it('takes a well-formed key name and public key, and refuses others', () => {
    const ok = mintSchema.safeParse({ key_name: 'DATAFORSEO_PASSWORD', public_key: { kty: 'RSA', n: N, e: 'AQAB' } });
    expect(ok.success).toBe(true);
    expect(mintSchema.safeParse({ key_name: 'dataforseo', public_key: { kty: 'RSA', n: N, e: 'AQAB' } }).success).toBe(false);
    expect(mintSchema.safeParse({ key_name: 'X', public_key: { kty: 'RSA', n: N, e: 'AQAB' } }).success).toBe(false);
    expect(mintSchema.safeParse({ key_name: 'GOOD_NAME', public_key: { kty: 'RSA', n: 'short', e: 'AQAB' } }).success).toBe(false);
    expect(mintSchema.safeParse({ key_name: 'GOOD_NAME', public_key: { kty: 'EC', n: N, e: 'AQAB' } }).success).toBe(false);
    expect(mintSchema.safeParse({ key_name: 'GOOD_NAME', public_key: { kty: 'RSA', n: N, e: 'AQAB' }, value: 'sneaky' }).success).toBe(false);
  });

  it('takes only the encrypted envelope, never a plain value', () => {
    const env = { v: 1, ek: 'B'.repeat(342), iv: 'C'.repeat(16), ct: 'D'.repeat(40) };
    expect(envelopeSchema.safeParse(env).success).toBe(true);
    expect(envelopeSchema.safeParse({ ...env, value: 'sk_live_plain' }).success).toBe(false);
    expect(envelopeSchema.safeParse({ value: 'sk_live_plain' }).success).toBe(false);
    expect(envelopeSchema.safeParse({ ...env, iv: 'short' }).success).toBe(false);
    expect(envelopeSchema.safeParse({ ...env, ct: 'not base64url!' }).success).toBe(false);
  });

  it('allows a post only from no origin, the null origin, or Citadel itself', () => {
    const own = ['citadel.becomeindelible.com'];
    expect(postOriginAllowed(null, own)).toBe(true);
    expect(postOriginAllowed('null', own)).toBe(true);
    expect(postOriginAllowed('https://citadel.becomeindelible.com', own)).toBe(true);
    expect(postOriginAllowed('https://reports.becomeindelible.com', own)).toBe(false);
    expect(postOriginAllowed('https://evil.example', own)).toBe(false);
    expect(postOriginAllowed('not a url', own)).toBe(false);
  });
});

describe('the page', () => {
  const waiting: PublicView = { ok: true, status: 'waiting', key_name: 'ELEVENLABS_API_KEY', label: 'ElevenLabs <key>', replaces_existing: true, public_key: { kty: 'RSA', n: N, e: 'AQAB', alg: 'RSA-OAEP-256' } };

  it('a waiting link shows the box, the name, the replace note and the public key, with the script carrying the nonce', () => {
    const { html, status } = dropPage(waiting, 'NONCE123');
    expect(status).toBe(200);
    expect(html).toContain('ElevenLabs &lt;key&gt;');
    expect(html).not.toContain('ElevenLabs <key>');
    expect(html).toContain('<code>ELEVENLABS_API_KEY</code>');
    expect(html).toContain('replaces the key already stored');
    expect(html).toContain('<textarea id="v"');
    expect(html).toContain('<script nonce="NONCE123">');
    expect(html).toContain(N);
    expect(html).toContain("crypto.subtle.encrypt({name:'RSA-OAEP'}");
  });

  it('a stored link says Stored and carries no key material', () => {
    const { html } = dropPage({ ok: true, status: 'stored', key_name: 'ELEVENLABS_API_KEY', label: 'ElevenLabs key' }, 'N');
    expect(html).toContain('<h1>Stored</h1>');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain(N);
  });

  it('received, failed, expired and altered links each say so', () => {
    expect(dropPage({ ok: true, status: 'received', key_name: 'K_K', label: 'k' }, 'N').html).toContain('data-status="received"');
    expect(dropPage({ ok: true, status: 'failed', key_name: 'K_K', label: 'k', failed_reason: 'bad <thing>' }, 'N').html).toContain('bad &lt;thing&gt;');
    const exp = dropPage({ ok: true, status: 'expired', key_name: 'K_K', label: 'k' }, 'N');
    expect(exp.status).toBe(410);
    expect(exp.html).toContain('expired');
    const alt = dropPage({ ok: false, status: 'altered' }, 'N');
    expect(alt.status).toBe(400);
    expect(alt.html).toContain('not valid');
  });

  it('the public key cannot break out of its script block', () => {
    const { html } = dropPage({ ...waiting, public_key: { n: '</script><script>alert(1)</script>' } }, 'N');
    expect(html).not.toContain('</script><script>alert(1)');
  });

  it('headers forbid framing, caching and other script sources', () => {
    const h = pageHeaders('abc');
    expect(h['Cache-Control']).toBe('no-store');
    expect(h['Content-Security-Policy']).toContain("script-src 'nonce-abc'");
    expect(h['Content-Security-Policy']).toContain("connect-src 'self'");
    expect(h['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  });
});
