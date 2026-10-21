/**
 * The upload validation core (phase C spec 6). Pure and shared: the file's type comes from its
 * MAGIC BYTES, never from the declared type or the name. Allowed: JPEG, PNG, WebP, GIF, HEIC/HEIF,
 * PDF, DOCX, XLSX, PPTX (zip containers checked for [Content_Types].xml and refused with a macro
 * project), plain text and CSV. Refused: SVG, HTML, executables, archives, macro-enabled Office,
 * and anything it cannot recognise. Images that carry script markup anywhere are refused as
 * polyglots.
 */
import crypto from 'crypto';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 10;
export const MAX_BYTES_PER_CONVERSATION = 150 * 1024 * 1024;
export const MAX_UPLOADS_PER_CONTACT_DAY = 60;
export const FILENAME_MAX = 120;

export interface Sniffed {
  content_type: string;
  ext: string;
  /** Images render inline; everything else downloads. */
  inline: boolean;
}

const IMAGE = (content_type: string, ext: string): Sniffed => ({ content_type, ext, inline: true });
const DOC = (content_type: string, ext: string): Sniffed => ({ content_type, ext, inline: false });

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'heif']);

function ascii(buf: Buffer, from: number, to: number): string {
  return buf.subarray(from, Math.min(to, buf.length)).toString('latin1');
}

/** Names of the entries in a zip container, read from the central directory. Null if it is not a readable zip. */
export function zipEntryNames(buf: Buffer): string[] | null {
  if (buf.length < 22) return null;
  // End of central directory record: scan back at most 64 KB + 22 for its signature.
  const min = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let n = 0; n < count && n < 10_000; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) return null;
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    if (offset + 46 + nameLen > buf.length) return null;
    names.push(buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8'));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** PDF actions that run code or open things on their own. Names may be hex-obfuscated (#6A = j), so decode first. */
const PDF_ACTIVE = /\/(?:JavaScript|JS|OpenAction|Launch|AA|RichMedia|XFA)(?![A-Za-z0-9])/;
export function pdfHasActiveContent(buf: Buffer): boolean {
  const text = buf.toString('latin1').replace(/#([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  return PDF_ACTIVE.test(text);
}

const SCRIPTISH = /<\s*script\b|<\?php|<\s*html\b|<\s*svg\b|<!doctype\s+html/i;

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 64 * 1024));
  for (const byte of sample) {
    if (byte === 0) return false;
    // Control characters other than tab, newline, carriage return, form feed.
    if (byte < 9 || (byte > 13 && byte < 32 && byte !== 27)) return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(0, sample.length - (sample.length === 64 * 1024 ? 3 : 0)));
  } catch {
    return false;
  }
  return true;
}

export type SniffResult = { ok: true; type: Sniffed } | { ok: false; reason: string };

export function sniffFile(buf: Buffer, declaredName = ''): SniffResult {
  if (buf.length === 0) return { ok: false, reason: 'That file is empty.' };
  let type: Sniffed | null = null;

  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) type = IMAGE('image/jpeg', 'jpg');
  else if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) type = IMAGE('image/png', 'png');
  else if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') type = IMAGE('image/webp', 'webp');
  else if (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a') type = IMAGE('image/gif', 'gif');
  else if (ascii(buf, 4, 8) === 'ftyp') {
    const brand = ascii(buf, 8, 12).trim().toLowerCase();
    if (HEIF_BRANDS.has(brand)) {
      const heic = brand.startsWith('he') && brand !== 'heif';
      type = IMAGE(heic ? 'image/heic' : 'image/heif', heic ? 'heic' : 'heif');
    }
  } else if (ascii(buf, 0, 5) === '%PDF-') {
    if (pdfHasActiveContent(buf)) return { ok: false, reason: 'That PDF contains active content and is not accepted. Please send a plain PDF or a photo.' };
    type = DOC('application/pdf', 'pdf');
  }
  else if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) {
    const names = zipEntryNames(buf);
    if (!names) return { ok: false, reason: 'That file could not be read.' };
    if (names.some((n) => /vbaProject\.bin$/i.test(n))) return { ok: false, reason: 'Files with macros are not accepted.' };
    if (!names.includes('[Content_Types].xml')) return { ok: false, reason: 'That kind of file is not accepted.' };
    if (names.some((n) => n.startsWith('word/'))) type = DOC('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx');
    else if (names.some((n) => n.startsWith('xl/'))) type = DOC('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx');
    else if (names.some((n) => n.startsWith('ppt/'))) type = DOC('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx');
    else return { ok: false, reason: 'That kind of file is not accepted.' };
  } else if (looksLikeText(buf)) {
    const head = buf.subarray(0, 4096).toString('utf8');
    if (SCRIPTISH.test(head) || /^\s*<\?xml/i.test(head) || /^\s*</.test(head) || head.startsWith('#!')) return { ok: false, reason: 'That kind of file is not accepted.' };
    const csv = /\.csv$/i.test(declaredName) && head.includes(',');
    type = csv ? DOC('text/csv', 'csv') : DOC('text/plain', 'txt');
  }

  if (!type) return { ok: false, reason: 'That kind of file is not accepted.' };
  if (type.inline && SCRIPTISH.test(buf.toString('latin1'))) return { ok: false, reason: 'That file could not be accepted.' };
  return { ok: true, type };
}

/** Name cleaned to [A-Za-z0-9._ -], 120 characters, with the extension of the SNIFFED type. */
export function sanitizeFilename(name: string, ext: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/\.[^.]*$/, '');
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._ -]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s-]+|[.\s]+$/g, '')
    .slice(0, FILENAME_MAX - ext.length - 1);
  return `${cleaned || 'file'}.${ext}`;
}

export function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export interface Validated {
  content_type: string;
  ext: string;
  inline: boolean;
  filename: string;
  size_bytes: number;
  sha256: string;
}

export function validateUpload(buf: Buffer, declaredName: string): { ok: true; file: Validated } | { ok: false; reason: string; status: number } {
  if (buf.length > MAX_FILE_BYTES) return { ok: false, reason: 'That file is too large. The limit is 20 MB.', status: 413 };
  const sniffed = sniffFile(buf, declaredName);
  if (!sniffed.ok) return { ok: false, reason: sniffed.reason, status: 400 };
  return {
    ok: true,
    file: {
      content_type: sniffed.type.content_type,
      ext: sniffed.type.ext,
      inline: sniffed.type.inline,
      filename: sanitizeFilename(declaredName, sniffed.type.ext),
      size_bytes: buf.length,
      sha256: sha256(buf),
    },
  };
}

/** Headers for serving a stored file: nosniff always, images inline, everything else a download. */
export function serveHeaders(file: { content_type: string; filename: string; size_bytes: number }): Record<string, string> {
  const inline = file.content_type.startsWith('image/');
  const safeName = file.filename.replace(/[^A-Za-z0-9._ -]/g, '_');
  return {
    'Content-Type': file.content_type,
    'Content-Length': String(file.size_bytes),
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  };
}
