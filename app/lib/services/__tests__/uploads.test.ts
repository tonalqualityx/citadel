import { describe, it, expect } from 'vitest';
import zlib from 'zlib';
import { PDF_MAX_INFLATED_PER_STREAM, PDF_MAX_OBJECT_STREAMS, pdfHasActiveContent, sanitizeFilename, serveHeaders, sniffFile, validateUpload, zipEntryNames, MAX_FILE_BYTES } from '../uploads';

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

// W6.1 F10: actions hidden inside a compressed object stream are found by inflating it (built-in zlib only).
describe('PDF object streams are inflated and scanned', () => {
  const objStm = (inner: string, dictExtra = '', data?: Buffer) => {
    const body = data ?? zlib.deflateSync(Buffer.from(inner, 'latin1'));
    return Buffer.concat([
      Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${body.length}${dictExtra} >>\nstream\n`, 'latin1'),
      body,
      Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
    ]);
  };
  it('refuses /OpenAction and /JavaScript inside a FlateDecode object stream', () => {
    const pdf = objStm('3 0 << /Type /Catalog /OpenAction 4 0 R >> << /S /JavaScript /JS (app.alert(1)) >>');
    expect(pdf.toString('latin1')).not.toMatch(/OpenAction|JavaScript/);
    expect(pdfHasActiveContent(pdf)).toBe(true);
    expect(validateUpload(pdf, 'brochure.pdf').ok).toBe(false);
  });
  it('refuses a hex-obfuscated name inside the stream, and a stream found by /First alone', () => {
    expect(pdfHasActiveContent(objStm('3 0 << /#4Fpen#41ction 4 0 R >>'))).toBe(true);
    const noType = Buffer.from(objStm('3 0 << /AA << /O 4 0 R >> >>').toString('latin1').replace('/Type /ObjStm ', ''), 'latin1');
    expect(pdfHasActiveContent(noType)).toBe(true);
  });
  it('accepts a plain object stream', () => {
    const pdf = objStm('3 0 << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>');
    expect(pdfHasActiveContent(pdf)).toBe(false);
    expect(validateUpload(pdf, 'menu.pdf').ok).toBe(true);
  });
  it('refuses what it cannot check: a stream that does not inflate, another filter, a predictor, an inflation bomb', () => {
    expect(pdfHasActiveContent(objStm('', '', Buffer.from('this is not deflate data at all')))).toBe(true);
    const a85 = Buffer.from(objStm('3 0 << /Type /Page >>').toString('latin1').replace('/Filter /FlateDecode', '/Filter [/ASCII85Decode /FlateDecode]'), 'latin1');
    expect(pdfHasActiveContent(a85)).toBe(true);
    expect(pdfHasActiveContent(objStm('3 0 << /Type /Page >>', ' /DecodeParms << /Predictor 12 /Columns 4 >>'))).toBe(true);
    const bomb = zlib.deflateSync(Buffer.alloc(PDF_MAX_INFLATED_PER_STREAM + 1024, 0x20));
    expect(pdfHasActiveContent(objStm('', '', bomb))).toBe(true);
  });
  it('does not inflate image or content streams (no blow-up, no false hits)', () => {
    const img = zlib.deflateSync(Buffer.alloc(PDF_MAX_INFLATED_PER_STREAM * 2, 0x41));
    const pdf = Buffer.concat([
      Buffer.from(`%PDF-1.7\n7 0 obj\n<< /Type /XObject /Subtype /Image /Width 10 /Height 10 /Filter /FlateDecode /Length ${img.length} >>\nstream\n`, 'latin1'),
      img,
      Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
    ]);
    expect(pdfHasActiveContent(pdf)).toBe(false);
  });
});

// W6.4 H1 and L1: the object-stream pass is one forward pass with hard budgets, and an object stream is read only over
// its exact extent.
describe('PDF object-stream pass: linear time, exact extents, fail closed', () => {
  const L = (s: string) => Buffer.from(s, 'latin1');
  const MB = 1024 * 1024;
  const repeat = (unit: string, bytes: number, head = '%PDF-1.4\n') => {
    const u = L(unit);
    return Buffer.concat([L(head), Buffer.alloc(Math.floor(bytes / u.length) * u.length, u), L('%%EOF\n')]);
  };
  const JS_INNER = '1 0 2 30 << /Type /Catalog /OpenAction 2 0 R >> << /S /JavaScript /JS (app.alert(1)) >>';
  /** One object stream object, with the pieces an attacker varies. */
  const objStmPdf = (o: { data?: Buffer; length?: string; beforeStream?: string; afterStream?: string; dictExtra?: string; extraObjs?: string } = {}) => {
    const data = o.data ?? zlib.deflateSync(L(JS_INNER));
    return Buffer.concat([
      L(`%PDF-1.5\n5 0 obj\n<< /Type /ObjStm /N 2 /First 8 /Filter /FlateDecode /Length ${o.length ?? data.length}${o.dictExtra ?? ''} >>${o.beforeStream ?? '\n'}stream${o.afterStream ?? '\n'}`),
      data,
      L(`\nendstream\nendobj\n${o.extraObjs ?? ''}%%EOF\n`),
    ]);
  };
  /** zlib data whose first block is stored and holds the bytes `endstream`; the active names come after, compressed. */
  const endstreamInside = (rest: string) => {
    const lit = L('% endstream\n');
    const stored = Buffer.concat([Buffer.from([0x00, lit.length & 255, lit.length >> 8, ~lit.length & 255, (~lit.length >> 8) & 255]), lit]);
    const all = Buffer.concat([lit, L(rest)]);
    let a = 1;
    let b = 0;
    for (const x of all) { a = (a + x) % 65521; b = (b + a) % 65521; }
    const ad = Buffer.alloc(4);
    ad.writeUInt32BE(((b << 16) | a) >>> 0);
    return Buffer.concat([Buffer.from([0x78, 0x01]), stored, zlib.deflateRawSync(L(rest)), ad]);
  };
  const timed = (buf: Buffer) => {
    const t = performance.now();
    const active = pdfHasActiveContent(buf);
    return { active, ms: performance.now() - t };
  };

  it.each([
    ['">>stream" repeated (the W6.4 p10 shape)', () => repeat('>>stream\n', 10 * MB)],
    ['many tiny object streams', () => {
      const tiny = zlib.deflateSync(L('3 0 << /Type /Page >>')).toString('latin1');
      return repeat(`5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${tiny.length} >>\nstream\n${tiny}\nendstream\nendobj\n`, 10 * MB);
    }],
    ['many tiny image streams', () => repeat('7 0 obj\n<< /Type /XObject /Subtype /Image /Length 4 >>\nstream\nabcd\nendstream\nendobj\n', 10 * MB)],
    ['object streams with no endstream', () => repeat('1 0 obj << /Type /ObjStm /First 4 /Length 5 >> stream\n', 10 * MB)],
    ['plain streams with no endstream', () => repeat('1 0 obj << /Length 5 >> stream\n', 10 * MB)],
    ['deeply repeated "<<"', () => repeat('<<', 10 * MB, '%PDF-1.4\n1 0 obj\n')],
    ['deeply repeated "["', () => repeat('[', 10 * MB, '%PDF-1.4\n1 0 obj\n<< /A ')],
    ['overlapping starts that never close', () => repeat('1 0 obj <</A (', 10 * MB)],
    ['an object start inside every string', () => repeat('(obj << ', 10 * MB, '%PDF-1.4\n1 0 obj\n<< /A ')],
    ['a comment after every object start', () => repeat('1 0 obj %', 10 * MB)],
    ['"obj" repeated', () => repeat('obj ', 10 * MB)],
    ['"#41" repeated', () => repeat('#41', 10 * MB)],
  ])('returns in under 1,000 ms at 10 MB: %s', (_label, make) => {
    const buf = make();
    expect(buf.length).toBeGreaterThan(9.9 * MB);
    expect(timed(buf).ms).toBeLessThan(1000);
  });

  it('returns in under 1,000 ms at 25 MB (the largest upload): one huge dictionary plus 64 MB of inflated object streams', () => {
    const d = zlib.deflateSync(Buffer.alloc(16 * MB - 16, L('/Type /Page /A #42 ')), { level: 9 });
    const one = Buffer.concat([L(`5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${d.length} >>\nstream\n`), d, L('\nendstream\nendobj\n')]);
    const tail = Buffer.concat([one, one, one, one]);
    const head = L('%PDF-1.5\n1 0 obj << /Big [');
    const buf = Buffer.concat([head, Buffer.alloc(25 * MB - head.length - tail.length - 16, L('12 0 R ')), L('] >>\n'), tail]);
    const r = timed(buf);
    expect(r.ms).toBeLessThan(1000);
    expect(r.active).toBe(false);
  });

  it('refuses when a budget runs out: too many objects, too many object streams, nesting too deep, overlapping starts', () => {
    expect(pdfHasActiveContent(repeat('obj ', 2 * MB))).toBe(true);
    const tiny = zlib.deflateSync(L('3 0 << /Type /Page >>'));
    const oneTiny = L(`5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${tiny.length} >>\nstream\n${tiny.toString('latin1')}\nendstream\nendobj\n`);
    const streams = (n: number) => Buffer.concat([L('%PDF-1.5\n'), ...Array<Buffer>(n).fill(oneTiny)]);
    expect(pdfHasActiveContent(streams(PDF_MAX_OBJECT_STREAMS))).toBe(false);
    expect(pdfHasActiveContent(streams(PDF_MAX_OBJECT_STREAMS + 1))).toBe(true);
    expect(pdfHasActiveContent(repeat('<<', 4096, '%PDF-1.4\n1 0 obj\n'))).toBe(true);
    expect(pdfHasActiveContent(repeat('1 0 obj <</A (', 64 * 1024))).toBe(true);
  });

  it('refuses JavaScript hidden behind the bytes "endstream" inside the data, with an indirect /Length (L1)', () => {
    const data = endstreamInside(JS_INNER);
    const pdf = objStmPdf({ data, length: '9 0 R', extraObjs: `9 0 obj\n${data.length}\nendobj\n` });
    expect(pdf.toString('latin1')).not.toMatch(/OpenAction|JavaScript/);
    expect(pdfHasActiveContent(pdf)).toBe(true);
  });

  it.each([
    ['a comment between ">>" and "stream"', { beforeStream: '\n%c\n' }],
    ['"stream" followed by CR alone', { afterStream: '\r' }],
    ['a string holding "<<" in the dictionary', { dictExtra: ' /Z (<<)' }],
    ['a string holding "1 0 obj" in the dictionary', { dictExtra: ' /Z (1 0 obj)' }],
    ['a dictionary over 64 KB', { dictExtra: ` /Pad (${'A'.repeat(70_000)})` }],
  ])('refuses JavaScript in an object stream with %s (L1)', (_label, o) => {
    expect(pdfHasActiveContent(objStmPdf(o))).toBe(true);
  });

  it('refuses an object stream it cannot read exactly: indirect DecodeParms, truncated data, a Length that misses endstream, an unresolvable or ambiguous Length', () => {
    const plain = '3 0 << /Type /Page >>';
    const data = zlib.deflateSync(L(plain));
    expect(pdfHasActiveContent(objStmPdf({ data, dictExtra: ' /DecodeParms 8 0 R' }))).toBe(true);
    expect(pdfHasActiveContent(objStmPdf({ data: data.subarray(0, data.length - 4) }))).toBe(true);
    expect(pdfHasActiveContent(objStmPdf({ data, length: String(data.length - 3) }))).toBe(true);
    expect(pdfHasActiveContent(objStmPdf({ data, length: '9 0 R' }))).toBe(true);
    expect(pdfHasActiveContent(objStmPdf({ data, length: '9 0 R', extraObjs: `9 0 obj\n${data.length}\nendobj\n9 0 obj\n${data.length + 1}\nendobj\n` }))).toBe(true);
    expect(pdfHasActiveContent(objStmPdf({ data, dictExtra: ' /Filter /FlateDecode' }))).toBe(true); // two Filter keys
    expect(pdfHasActiveContent(objStmPdf({ data, dictExtra: ' /F (other.bin)' }))).toBe(true); // data in another file
  });

  it('accepts honest object streams: indirect Length that resolves, CR LF after stream, a filter array, an incremental update copy', () => {
    const data = zlib.deflateSync(L('3 0 << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>'));
    const len = `9 0 obj\n${data.length}\nendobj\n`;
    expect(pdfHasActiveContent(objStmPdf({ data, length: '9 0 R', extraObjs: len }))).toBe(false);
    expect(pdfHasActiveContent(objStmPdf({ data, length: '9 0 R', extraObjs: len + len }))).toBe(false);
    expect(pdfHasActiveContent(objStmPdf({ data, afterStream: '\r\n' }))).toBe(false);
    const arr = Buffer.from(objStmPdf({ data }).toString('latin1').replace('/Filter /FlateDecode', '/Filter [/FlateDecode]'), 'latin1');
    expect(pdfHasActiveContent(arr)).toBe(false);
    expect(validateUpload(objStmPdf({ data, length: '9 0 R', extraObjs: len }), 'menu.pdf').ok).toBe(true);
  });
});
