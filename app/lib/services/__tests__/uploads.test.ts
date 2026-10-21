import { describe, it, expect } from 'vitest';
import { pdfHasActiveContent, sanitizeFilename, serveHeaders, sniffFile, validateUpload, zipEntryNames, MAX_FILE_BYTES } from '../uploads';

/** A stored (uncompressed) zip with empty entries: enough for the container checks. */
export function makeZip(names: string[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

describe('sniffFile (magic bytes, never the declared name)', () => {
  it('accepts the image types', () => {
    expect(sniffFile(jpeg)).toMatchObject({ ok: true, type: { content_type: 'image/jpeg', inline: true } });
    expect(sniffFile(png)).toMatchObject({ ok: true, type: { content_type: 'image/png' } });
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(16)]);
    expect(sniffFile(webp)).toMatchObject({ ok: true, type: { content_type: 'image/webp' } });
    expect(sniffFile(Buffer.from('GIF89a' + 'x'.repeat(20)))).toMatchObject({ ok: true, type: { content_type: 'image/gif' } });
  });

  it('accepts a phone photo in HEIC and HEIF', () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(20)]);
    const heif = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmif1'), Buffer.alloc(20)]);
    expect(sniffFile(heic)).toMatchObject({ ok: true, type: { content_type: 'image/heic', ext: 'heic' } });
    expect(sniffFile(heif)).toMatchObject({ ok: true, type: { content_type: 'image/heif' } });
    // An mp4 brand is not an image.
    expect(sniffFile(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(20)])).ok).toBe(false);
  });

  it('accepts PDF, DOCX, XLSX, PPTX', () => {
    expect(sniffFile(Buffer.from('%PDF-1.7\n...'))).toMatchObject({ ok: true, type: { content_type: 'application/pdf', inline: false } });
    expect(sniffFile(makeZip(['[Content_Types].xml', 'word/document.xml']))).toMatchObject({ ok: true, type: { ext: 'docx' } });
    expect(sniffFile(makeZip(['[Content_Types].xml', 'xl/workbook.xml']))).toMatchObject({ ok: true, type: { ext: 'xlsx' } });
    expect(sniffFile(makeZip(['[Content_Types].xml', 'ppt/presentation.xml']))).toMatchObject({ ok: true, type: { ext: 'pptx' } });
  });

  it('refuses a macro-enabled document', () => {
    const docm = sniffFile(makeZip(['[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin']));
    expect(docm.ok).toBe(false);
  });

  it('refuses a zip that is not an Office container, and archives', () => {
    expect(sniffFile(makeZip(['a.txt', 'b.txt'])).ok).toBe(false);
    expect(sniffFile(Buffer.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0])).ok).toBe(false);
  });

  it('refuses SVG and HTML, however they are named', () => {
    expect(validateUpload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'logo.png').ok).toBe(false);
    expect(validateUpload(Buffer.from('<?xml version="1.0"?><svg/>'), 'x.jpg').ok).toBe(false);
    expect(validateUpload(Buffer.from('<!doctype html><html><body>hi</body></html>'), 'page.txt').ok).toBe(false);
    expect(validateUpload(Buffer.from('  <html>'), 'a.txt').ok).toBe(false);
  });

  it('refuses executables and scripts', () => {
    expect(sniffFile(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0])).ok).toBe(false);
    expect(sniffFile(Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0])).ok).toBe(false);
    expect(validateUpload(Buffer.from('#!/bin/sh\nrm -rf x\n'), 'run.sh').ok).toBe(false);
  });

  it('types a PNG named .exe as a PNG, and names it .png', () => {
    const v = validateUpload(png, 'photo.exe');
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.file.content_type).toBe('image/png');
      expect(v.file.filename).toBe('photo.png');
    }
  });

  it('refuses a polyglot: an image that carries script markup', () => {
    expect(validateUpload(Buffer.concat([png, Buffer.from('<script>alert(1)</script>')]), 'a.png').ok).toBe(false);
    expect(validateUpload(Buffer.concat([jpeg, Buffer.from('<?php system($_GET[0]); ?>')]), 'a.jpg').ok).toBe(false);
    expect(validateUpload(Buffer.concat([Buffer.from('GIF89a'), Buffer.from('<html><script>x</script>')]), 'a.gif').ok).toBe(false);
  });

  it('accepts plain text and CSV, refuses binary noise and empty files', () => {
    expect(sniffFile(Buffer.from('Opening hours: 9 to 5\n'))).toMatchObject({ ok: true, type: { content_type: 'text/plain' } });
    expect(sniffFile(Buffer.from('a,b\n1,2\n'), 'rows.csv')).toMatchObject({ ok: true, type: { content_type: 'text/csv' } });
    expect(sniffFile(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).ok).toBe(false);
    expect(sniffFile(Buffer.alloc(0)).ok).toBe(false);
  });

  it('enforces the 20 MB limit', () => {
    const big = Buffer.concat([png, Buffer.alloc(MAX_FILE_BYTES)]);
    const v = validateUpload(big, 'big.png');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.status).toBe(413);
  });
});

describe('zipEntryNames', () => {
  it('reads names and refuses garbage', () => {
    expect(zipEntryNames(makeZip(['a', 'b/c']))).toEqual(['a', 'b/c']);
    expect(zipEntryNames(Buffer.from('not a zip at all, definitely'))).toBeNull();
  });
});

describe('names and headers', () => {
  it('sanitizes to [A-Za-z0-9._ -], 120 characters, extension from the sniffed type', () => {
    expect(sanitizeFilename('../../etc/pass wd?.php', 'png')).toBe('pass wd.png');
    expect(sanitizeFilename('', 'jpg')).toBe('file.jpg');
    const long = sanitizeFilename('x'.repeat(300) + '.exe', 'png');
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('.png')).toBe(true);
    expect(sanitizeFilename('Zoë <b>"menu"</b>.docx', 'pdf')).toMatch(/^[A-Za-z0-9._ -]+$/);
  });

  it('serves images inline and everything else as a download, with nosniff', () => {
    const img = serveHeaders({ content_type: 'image/png', filename: 'a.png', size_bytes: 3 });
    expect(img['X-Content-Type-Options']).toBe('nosniff');
    expect(img['Content-Disposition']).toMatch(/^inline/);
    const doc = serveHeaders({ content_type: 'application/pdf', filename: 'a.pdf', size_bytes: 3 });
    expect(doc['Content-Disposition']).toMatch(/^attachment/);
  });
});

describe('PDFs with active content are refused', () => {
  const pdf = (body: string) => Buffer.from(`%PDF-1.7\n${body}\n%%EOF`);
  it.each([
    ['/JavaScript action', '1 0 obj << /Type /Action /S /JavaScript /JS (app.alert(1)) >> endobj'],
    ['/JS alone', '2 0 obj << /S /Foo /JS (x) >> endobj'],
    ['/OpenAction', '<< /Type /Catalog /OpenAction 3 0 R >>'],
    ['/Launch', '<< /S /Launch /F (cmd.exe) >>'],
    ['additional actions /AA', '<< /Type /Page /AA << /O 4 0 R >> >>'],
    ['a hex-obfuscated name', '<< /S /J#61vaScr#69pt /JS (x) >>'],
    ['a hex-obfuscated OpenAction', '<< /#4Fpen#41ction 3 0 R >>'],
  ])('refuses %s', (_label, body) => {
    expect(pdfHasActiveContent(pdf(body))).toBe(true);
    expect(validateUpload(pdf(body), 'invoice.pdf').ok).toBe(false);
  });
  it('accepts a plain PDF, even one that talks about JavaScript in its text', () => {
    const plain = pdf('<< /Type /Catalog /Pages 2 0 R >>\nBT (We build with JavaScript and OpenAction-free pages) Tj ET');
    expect(pdfHasActiveContent(plain)).toBe(false);
    expect(validateUpload(plain, 'menu.pdf')).toMatchObject({ ok: true, file: { content_type: 'application/pdf' } });
  });
});
