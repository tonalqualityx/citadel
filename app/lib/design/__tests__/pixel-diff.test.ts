// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { deflateSync, inflateSync, crc32 } from 'node:zlib';
import { diffImageData, type RgbaImage } from '../pixel-diff';

// Tiny PNG codec for the fixtures: 8-bit RGBA, filter 0 only. Proves the fixtures are real PNG files.
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(img: RgbaImage): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows: Buffer[] = [];
  for (let y = 0; y < img.height; y++) {
    rows.push(Buffer.from([0]), Buffer.from(Array.from(img.data).slice(y * img.width * 4, (y + 1) * img.width * 4)));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function decodePng(png: Buffer): RgbaImage {
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString('ascii');
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width * 4 + 1)]).toBe(0);
    raw.copy(Buffer.from(out.buffer), y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1));
  }
  return { width, height, data: out };
}

function solid(w: number, h: number, rgba: [number, number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { width: w, height: h, data };
}

function setPixel(img: RgbaImage, x: number, y: number, rgba: [number, number, number, number]) {
  (img.data as Uint8ClampedArray).set(rgba, (y * img.width + x) * 4);
}

describe('diffImageData on 4x4 PNG fixtures', () => {
  const white = solid(4, 4, [255, 255, 255, 255]);
  const changed = solid(4, 4, [255, 255, 255, 255]);
  setPixel(changed, 1, 1, [0, 0, 0, 255]);
  setPixel(changed, 3, 2, [200, 30, 30, 255]);
  const a = decodePng(encodePng(white));
  const b = decodePng(encodePng(changed));

  it('round-trips the fixtures as real PNGs', () => {
    expect(a.width).toBe(4);
    expect(Array.from(b.data)).toEqual(Array.from(changed.data));
  });

  it('counts exactly the differing pixels and marks them in the overlay', () => {
    const r = diffImageData(a, b);
    expect(r.count).toBe(2);
    expect(r.ratio).toBeCloseTo(2 / 16);
    expect(r.sizeMismatch).toBe(false);
    const at = (x: number, y: number) => Array.from(r.overlay.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    expect(at(1, 1)).toEqual([255, 0, 170, 255]);
    expect(at(3, 2)).toEqual([255, 0, 170, 255]);
    expect(at(0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('is zero for identical images', () => {
    expect(diffImageData(a, decodePng(encodePng(white))).count).toBe(0);
  });

  it('ignores differences within the tolerance', () => {
    const near = solid(4, 4, [250, 255, 255, 255]);
    expect(diffImageData(a, near, 8).count).toBe(0);
    expect(diffImageData(a, near, 2).count).toBe(16);
  });

  it('compares the overlap and flags a size mismatch', () => {
    const r = diffImageData(a, solid(2, 3, [0, 0, 0, 255]));
    expect(r.sizeMismatch).toBe(true);
    expect(r.width).toBe(2);
    expect(r.height).toBe(3);
    expect(r.count).toBe(6);
  });
});
