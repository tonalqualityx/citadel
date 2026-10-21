import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent: Array<{ kind: string; input: Record<string, unknown> }> = [];
vi.mock('@aws-sdk/client-s3', () => {
  class Cmd {
    constructor(public input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      async send(cmd: Cmd) {
        sent.push({ kind: cmd.constructor.name, input: cmd.input });
        return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
      }
    },
    PutObjectCommand: class PutObjectCommand extends Cmd {},
    GetObjectCommand: class GetObjectCommand extends Cmd {},
  };
});

async function load() {
  vi.resetModules();
  vi.stubEnv('AWS_S3_BUCKET', 'indelible-test-bucket');
  vi.stubEnv('AWS_ACCESS_KEY_ID', 'x');
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'y');
  vi.stubEnv('AWS_REGION', 'us-east-1');
  return import('../s3');
}

beforeEach(() => {
  sent.length = 0;
});

describe('private portal storage (phase C spec 6, 15)', () => {
  it('writes only under portal-private/ with no ACL and never to the public uploads prefix', async () => {
    const s3 = await load();
    await s3.putPrivateObject('portal-private/client-1/att-1', Buffer.from('x'), 'image/png');
    expect(sent).toHaveLength(1);
    const input = sent[0].input;
    expect(String(input.Key)).toMatch(/^portal-private\//);
    expect(input).not.toHaveProperty('ACL');
    expect(JSON.stringify(input)).not.toMatch(/public-read/);
    expect(input.ServerSideEncryption).toBe('AES256');
    const url = await s3.uploadToS3(Buffer.from('x'), 'a.png', 'image/png');
    expect(url).toContain('/uploads/');
    expect(String(sent[1].input.Key)).toMatch(/^uploads\//);
  });

  it('refuses a key under the public prefixes or with traversal', async () => {
    const s3 = await load();
    for (const key of ['uploads/a.png', 'public/a.png', 'portal-private/../uploads/a.png', 'other/a.png', '']) {
      await expect(s3.putPrivateObject(key, Buffer.from('x'), 'image/png')).rejects.toThrow();
      await expect(s3.getPrivateObject(key)).rejects.toThrow();
    }
    expect(sent).toHaveLength(0);
  });

  it('the rollout probe passes only when an anonymous fetch of a private object is refused', async () => {
    const s3 = await load();
    const put = vi.fn().mockResolvedValue(undefined);
    const refuse = vi.fn().mockResolvedValue({ status: 403 });
    expect(await s3.verifyPrivateNotPublic({ fetchImpl: refuse as never, put })).toMatchObject({ ok: true, status: 403 });
    expect(put.mock.calls[0][0]).toMatch(/^portal-private\//);
    expect(String(refuse.mock.calls[0][0])).toContain('/portal-private/');
    const open = vi.fn().mockResolvedValue({ status: 200 });
    expect(await s3.verifyPrivateNotPublic({ fetchImpl: open as never, put })).toMatchObject({ ok: false, status: 200 });
    const missing = vi.fn().mockResolvedValue({ status: 404 });
    // A 404 on an object we just wrote means the probe is not reading what we wrote: not a pass.
    expect((await s3.verifyPrivateNotPublic({ fetchImpl: missing as never, put })).ok).toBe(false);
  });
});
