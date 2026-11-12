/**
 * The upload validation core (phase C spec 6). Pure and shared: the file's type comes from its
 * MAGIC BYTES, never from the declared type or the name. Allowed: JPEG, PNG, WebP, GIF, HEIC/HEIF,
 * PDF, DOCX, XLSX, PPTX (zip containers checked for [Content_Types].xml and refused with a macro
 * project), plain text and CSV. Refused: SVG, HTML, executables, archives, macro-enabled Office,
 * and anything it cannot recognise. Images that carry script markup anywhere are refused as
 * polyglots.
 */
import crypto from 'crypto';
import zlib from 'zlib';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 10;
export const MAX_BYTES_PER_CONVERSATION = 150 * 1024 * 1024;
export const MAX_UPLOADS_PER_CONTACT_HOUR = 30;
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

/**
 * PDF actions that run code or open things on their own. Names may be hex-obfuscated (#6A = j), so decode first.
 * The raw bytes are scanned, and so is every object stream (W6.1 F10): a reader finds dictionaries inside a compressed
 * object stream (any stream whose dictionary names `/First` or `/ObjStm`), so those are inflated with the built-in zlib
 * and scanned the same way.
 *
 * W6.4 H1: the structural pass is linear in the file size. One forward pass finds every `obj` keyword (an object start,
 * as a reader's xref or reconstruction finds them); from each start a small PDF tokenizer reads the dictionary forward
 * (strings, hex strings, comments and nesting handled), then looks for `stream` after it. Nothing walks backwards.
 * Hard budgets, every one fail closed (the PDF is refused when one runs out):
 *   - work: the tokenizer may visit at most the file size plus 4 MB of bytes in all (overlapping starts cost);
 *   - 500,000 object starts, 200,000 streams, 1,000 object streams, dictionaries nested at most 256 deep;
 *   - inflated: 16 MB per object stream, 64 MB in all.
 * W6.4 L1: an object stream is inflated only over its EXACT extent: `/Length` direct, or an indirect `N G R` that
 * resolves to exactly one integer object, and `endstream` right after the data. An object stream whose extent cannot
 * be determined that way, whose data does not inflate to the end of its zlib stream, that names `/DecodeParms` or an
 * external file, or whose filter is anything but one FlateDecode, counts as active: refused, never let through unread.
 * Image and content streams are never inflated.
 */
const PDF_ACTIVE = /\/(?:JavaScript|JS|OpenAction|Launch|AA|RichMedia|XFA)(?![A-Za-z0-9])/;
export const PDF_MAX_OBJECT_STREAMS = 1000;
export const PDF_MAX_INFLATED_PER_STREAM = 16 * 1024 * 1024;
export const PDF_MAX_INFLATED_TOTAL = 64 * 1024 * 1024;
export const PDF_MAX_OBJECTS = 500_000;
export const PDF_MAX_STREAMS = 200_000;
export const PDF_MAX_NESTING = 256;
/** Copies of one object number an indirect /Length may resolve through (incremental updates make a few). */
const PDF_MAX_LENGTH_COPIES = 64;
/**
 * Bytes the structural pass may visit in all, for a file of `len` bytes. An honest file's dictionaries are read once each
 * (stream data is never tokenized), so it stays well under `len`; only starts that overlap (an `obj <<` inside another
 * dictionary's string, over and over) spend more, and those files are refused.
 */
export const pdfWorkBudget = (len: number): number => len + 4 * 1024 * 1024;

/** A budget ran out or something could not be checked: the caller refuses the PDF. */
class PdfUncheckable extends Error {}

// Byte classes of the PDF lexer: 0 regular, 1 white space, 2 delimiter.
const PDF_CLASS = new Uint8Array(256);
for (const c of [0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]) PDF_CLASS[c] = 1;
for (const c of '()<>[]{}/%') PDF_CLASS[c.charCodeAt(0)] = 2;
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;
const HEX = new Int8Array(256).fill(-1);
for (let i = 0; i < 256; i++) HEX[i] = i >= 0x30 && i <= 0x39 ? i - 0x30 : i >= 0x41 && i <= 0x46 ? i - 0x37 : i >= 0x61 && i <= 0x66 ? i - 0x57 : -1;

/** The bytes with every `#xx` decoded (one linear loop; the input itself when there is no `#`). */
function decodePdfNameBytes(buf: Buffer): Buffer {
  if (buf.indexOf(0x23) < 0) return buf;
  const n = buf.length;
  const out = Buffer.allocUnsafe(n);
  let o = 0;
  for (let i = 0; i < n; i++) {
    const c = buf[i];
    if (c === 0x23 && i + 2 < n) {
      const h = HEX[buf[i + 1]];
      const l = HEX[buf[i + 2]];
      if (h >= 0 && l >= 0) {
        out[o++] = (h << 4) | l;
        i += 2;
        continue;
      }
    }
    out[o++] = c;
  }
  return out.subarray(0, o);
}

const namesActive = (buf: Buffer): boolean => PDF_ACTIVE.test(decodePdfNameBytes(buf).toString('latin1'));

export function pdfHasActiveContent(buf: Buffer): boolean {
  if (namesActive(buf)) return true;
  try {
    return objectStreamsHaveActiveContent(buf);
  } catch {
    return true; // a budget ran out or it could not be checked: refuse
  }
}

// Tokens kept from a dictionary's top level, for pairing keys and values. Deeper tokens are only walked over.
const T_NAME = 1, T_INT = 2, T_WORD = 3, T_OPEN = 4, T_CLOSE = 5, T_STR = 6;
/** Top-level tokens kept per dictionary: more than this and the dictionary cannot be an object stream we check. */
const PDF_MAX_TOP_TOKENS = 4096;
/** Names longer than this (raw) are never one of the few names the check looks at, so they are not decoded. */
const NAME_KEEP_RAW = 40;

interface ParsedDict {
  end: number;
  /** Every short name at any depth, decoded. */
  names: Set<string>;
  /** Top-level tokens (kind, value or null, the offset an `open` starts at), or null when there were too many. */
  kinds: number[] | null;
  vals: (string | null)[];
  at: number[];
}

const NO_NAMES: Set<string> = new Set();

class PdfScan {
  left: number;
  readonly buf: Buffer;
  readonly len: number;
  constructor(buf: Buffer) {
    this.buf = buf;
    this.len = buf.length;
    this.left = pdfWorkBudget(buf.length);
  }

  readonly stack: number[] = [];

  spend(n: number): void {
    this.left -= n;
    if (this.left < 0) throw new PdfUncheckable('work budget');
  }

  /** Past white space and comments (a reader's lexer skips both). */
  skipWsComments(p: number): number {
    const { buf, len } = this;
    const from = p;
    while (p < len) {
      const c = buf[p];
      if (PDF_CLASS[c] === 1) p++;
      else if (c === 0x25) {
        while (p < len && buf[p] !== 0x0a && buf[p] !== 0x0d) p++;
      } else break;
    }
    this.spend(p - from + 1);
    return p;
  }

  /** The end of a run of regular characters starting at p. */
  regularEnd(p: number): number {
    const { buf, len } = this;
    const from = p;
    while (p < len && PDF_CLASS[buf[p]] === 0) p++;
    this.spend(p - from);
    return p;
  }

  /**
   * The dictionary opened by the `<<` at p, read forward to its matching `>>`. Null when it never closes. Without
   * `detail` only its end is found (nothing is kept, nothing allocated per token): that is the pass every object start
   * gets; only a dictionary followed by `stream` is read again with `detail`.
   */
  dict(p: number, detail: boolean): ParsedDict | null {
    const { buf, len } = this;
    const stack = this.stack;
    stack.length = 0;
    stack.push(1); // 1 dictionary, 2 array
    const names = detail ? new Set<string>() : NO_NAMES;
    let kinds: number[] | null = detail ? [] : null;
    const vals: (string | null)[] = [];
    const at: number[] = [];
    const keep = (kind: number, val: string | null, pos: number) => {
      if (!kinds) return;
      if (kinds.length >= PDF_MAX_TOP_TOKENS) { kinds = null; return; }
      kinds.push(kind);
      vals.push(val);
      at.push(pos);
    };
    let q = p + 2;
    for (;;) {
      if (q >= len) return null;
      this.spend(1);
      const c = buf[q];
      const top = stack.length === 1;
      if (PDF_CLASS[c] === 1) { q++; continue; }
      if (c === 0x25) { q = this.skipWsComments(q); continue; }
      if (c === 0x28) { // ( literal string )
        const from = q;
        let depth = 1;
        q++;
        while (depth > 0 && q < len) {
          const x = buf[q];
          if (x === 0x5c) q += 2;
          else { if (x === 0x28) depth++; else if (x === 0x29) depth--; q++; }
        }
        this.spend(q - from);
        if (depth > 0) return null;
        if (top) keep(T_STR, null, from);
        continue;
      }
      if (c === 0x3c) {
        if (q + 1 < len && buf[q + 1] === 0x3c) {
          if (stack.length >= PDF_MAX_NESTING) throw new PdfUncheckable('nesting');
          if (top) keep(T_OPEN, '<<', q);
          stack.push(1);
          q += 2;
          continue;
        }
        const from = q; // <hex string>
        const e = buf.indexOf(0x3e, q + 1);
        if (e < 0) return null;
        q = e + 1;
        this.spend(q - from);
        if (top) keep(T_STR, null, from);
        continue;
      }
      if (c === 0x3e) {
        if (q + 1 < len && buf[q + 1] === 0x3e) {
          q += 2;
          while (stack.length && stack.pop() !== 1) { /* an unclosed array inside closes with its dictionary */ }
          if (!stack.length) return { end: q, names, kinds, vals, at };
          if (stack.length === 1) keep(T_CLOSE, '>>', q);
          continue;
        }
        q++;
        continue;
      }
      if (c === 0x5b) {
        if (stack.length >= PDF_MAX_NESTING) throw new PdfUncheckable('nesting');
        if (top) keep(T_OPEN, '[', q);
        stack.push(2);
        q++;
        continue;
      }
      if (c === 0x5d) {
        if (stack[stack.length - 1] === 2) {
          stack.pop();
          if (stack.length === 1) keep(T_CLOSE, ']', q);
        }
        q++;
        continue;
      }
      if (c === 0x2f) {
        const e = this.regularEnd(q + 1);
        let name: string | null = null;
        if (detail && e - q - 1 <= NAME_KEEP_RAW) {
          name = decodePdfNameBytes(buf.subarray(q + 1, e)).toString('latin1');
          names.add(name);
        }
        if (top && kinds) keep(T_NAME, name, q);
        q = e;
        continue;
      }
      if (PDF_CLASS[c] === 2) { q++; continue; } // a stray ) { }
      const e = this.regularEnd(q + 1);
      if (top && kinds) {
        let digits = e - q <= 12;
        for (let i = q; digits && i < e; i++) if (!isDigit(buf[i])) digits = false;
        keep(digits ? T_INT : T_WORD, e - q <= 12 ? buf.toString('latin1', q, e) : null, q);
      }
      q = e;
    }
  }

  /** The names of a filter array starting at the `[` at p: null when it holds anything but names. */
  nameArray(p: number): string[] | null {
    const { buf, len } = this;
    const out: string[] = [];
    let q = p + 1;
    for (;;) {
      q = this.skipWsComments(q);
      if (q >= len || out.length > 16) return null;
      if (buf[q] === 0x5d) return out;
      if (buf[q] !== 0x2f) return null;
      const e = this.regularEnd(q + 1);
      out.push(decodePdfNameBytes(buf.subarray(q + 1, e)).toString('latin1'));
      q = e;
    }
  }
}

/**
 * Top-level keys of a dictionary and the index of each value in its kept tokens. Keys and values are paired as a reader
 * pairs them (a value may be a name, a container or `N G R`; a token where a key should be that is not a name is
 * skipped). Two copies of a key, or a key too long to keep: uncheckable, since readers differ on which one wins.
 */
function topKeys(dict: ParsedDict): Map<string, number> {
  const kinds = dict.kinds;
  if (!kinds) throw new PdfUncheckable('dictionary too large');
  const keys = new Map<string, number>();
  let i = 0;
  while (i < kinds.length) {
    if (kinds[i] !== T_NAME) { i++; continue; }
    const key = dict.vals[i];
    if (key === null) throw new PdfUncheckable('long key');
    if (keys.has(key)) throw new PdfUncheckable('duplicate key');
    keys.set(key, i + 1);
    i++;
    if (i >= kinds.length) break;
    if (kinds[i] === T_OPEN) {
      let depth = 0;
      for (; i < kinds.length; i++) {
        if (kinds[i] === T_OPEN) depth++;
        else if (kinds[i] === T_CLOSE && --depth === 0) break;
      }
      i++;
    } else if (kinds[i] === T_INT && kinds[i + 1] === T_INT && kinds[i + 2] === T_WORD && dict.vals[i + 2] === 'R') i += 3;
    else i++;
  }
  return keys;
}

const STREAM = Buffer.from('stream', 'latin1');
/** The keyword `stream` at p, as a whole token. */
function isStreamKeyword(buf: Buffer, p: number): boolean {
  if (p + 6 > buf.length || buf.compare(STREAM, 0, 6, p, p + 6) !== 0) return false;
  return p + 6 >= buf.length || PDF_CLASS[buf[p + 6]] !== 0;
}

function digitsValue(buf: Buffer, from: number, to: number): number {
  let v = 0;
  for (let i = from; i < to; i++) v = v * 10 + (buf[i] - 0x30);
  return v;
}

function objectStreamsHaveActiveContent(buf: Buffer): boolean {
  const s = new PdfScan(buf);
  const len = buf.length;

  // Pass 1, forward: every `obj` keyword is an object start; the `N G` before it, when it is plain, is recorded for
  // resolving an indirect /Length.
  const starts: number[] = [];
  const nums: number[] = [];
  const gens: number[] = [];
  const OBJ = Buffer.from('obj', 'latin1');
  for (let i = buf.indexOf(OBJ, 0); i >= 0; i = buf.indexOf(OBJ, i + 3)) {
    if ((i > 0 && PDF_CLASS[buf[i - 1]] === 0) || (i + 3 < len && PDF_CLASS[buf[i + 3]] === 0)) continue;
    if (starts.length >= PDF_MAX_OBJECTS) return true;
    starts.push(i + 3);
    let j = i - 1;
    let k = 0;
    while (j >= 0 && PDF_CLASS[buf[j]] === 1 && k++ < 64) j--;
    const gEnd = j + 1;
    while (j >= 0 && isDigit(buf[j]) && gEnd - j <= 10) j--;
    const gStart = j + 1;
    k = 0;
    while (j >= 0 && PDF_CLASS[buf[j]] === 1 && k++ < 64) j--;
    const nEnd = j + 1;
    while (j >= 0 && isDigit(buf[j]) && nEnd - j <= 10) j--;
    const nStart = j + 1;
    const plain = gEnd > gStart && nEnd > nStart && nEnd < gStart && (j < 0 || PDF_CLASS[buf[j]] !== 0);
    nums.push(plain ? digitsValue(buf, nStart, nEnd) : -1);
    gens.push(plain ? digitsValue(buf, gStart, gEnd) : -1);
  }

  /** The integer an indirect object `n g` holds, when every copy of it is exactly `int endobj` and they agree. */
  let byNum: Map<number, number[]> | null = null;
  const resolved = new Map<string, number>();
  const resolveInt = (n: number, g: number): number => {
    const known = resolved.get(`${n} ${g}`);
    if (known !== undefined) return known;
    if (!byNum) {
      byNum = new Map();
      for (let i = 0; i < nums.length; i++) {
        if (nums[i] < 0) continue;
        const list = byNum.get(nums[i]);
        if (list) list.push(i);
        else byNum.set(nums[i], [i]);
      }
    }
    let value = -1;
    const copies = byNum.get(n) ?? [];
    if (copies.length > PDF_MAX_LENGTH_COPIES) throw new PdfUncheckable('length object');
    for (const i of copies) {
      if (gens[i] !== g) continue;
      let q = starts[i];
      while (q < len && PDF_CLASS[buf[q]] === 1) { s.spend(1); q++; }
      const a = q;
      while (q < len && isDigit(buf[q]) && q - a < 12) { s.spend(1); q++; }
      if (q === a) throw new PdfUncheckable('length object');
      const v = Number(buf.toString('latin1', a, q));
      while (q < len && PDF_CLASS[buf[q]] === 1) { s.spend(1); q++; }
      if (buf.toString('latin1', q, q + 6) !== 'endobj') throw new PdfUncheckable('length object');
      if (value >= 0 && v !== value) throw new PdfUncheckable('length object');
      value = v;
    }
    if (value < 0) throw new PdfUncheckable('length object');
    resolved.set(`${n} ${g}`, value);
    return value;
  };

  let streams = 0;
  let objStms = 0;
  let total = 0;
  for (const start of starts) {
    const p = s.skipWsComments(start);
    if (p + 1 >= len || buf[p] !== 0x3c || buf[p + 1] !== 0x3c) continue;
    const shape = s.dict(p, false);
    if (!shape) continue; // never closes: no stream can follow
    const kw = s.skipWsComments(shape.end);
    if (!isStreamKeyword(buf, kw)) continue;
    if (++streams > PDF_MAX_STREAMS) return true;
    const left = s.left;
    const dict = s.dict(p, true) as ParsedDict; // the same bytes again: not charged twice, so it costs at most the first read
    s.left = left;
    if (!dict.names.has('First') && !dict.names.has('ObjStm')) continue; // image, content, xref: never inflated
    if (++objStms > PDF_MAX_OBJECT_STREAMS) return true;

    // The data starts after the end of the `stream` line (CR LF, LF or CR alone), as a reader's lexer skips it.
    let dataStart = kw + 6;
    while (dataStart < len && buf[dataStart] !== 0x0a && buf[dataStart] !== 0x0d) { s.spend(1); dataStart++; }
    if (dataStart >= len) return true;
    dataStart += buf[dataStart] === 0x0d && buf[dataStart + 1] === 0x0a ? 2 : 1;

    for (const key of ['DecodeParms', 'DP', 'F', 'FFilter', 'FDecodeParms']) if (dict.names.has(key)) return true;

    // Filter: absent, one name, or an array of names; only nothing or one FlateDecode is read.
    const keys = topKeys(dict);
    const fv = keys.get('Filter');
    let filters: string[] = [];
    if (fv !== undefined) {
      const kind = dict.kinds?.[fv];
      const val = dict.vals[fv];
      if (kind === T_NAME && val !== null) filters = [val];
      else if (kind === T_OPEN && val === '[') {
        const arr = s.nameArray(dict.at[fv]);
        if (!arr) return true;
        filters = arr;
      } else return true;
    }
    if (!(filters.length === 0 || (filters.length === 1 && (filters[0] === 'FlateDecode' || filters[0] === 'Fl')))) return true;

    // Length: a direct integer, or `N G R` that resolves to one integer object.
    const lv = keys.get('Length');
    const kinds = dict.kinds as number[];
    if (lv === undefined || kinds[lv] !== T_INT) return true;
    const direct = Number(dict.vals[lv]);
    const indirect = kinds[lv + 1] === T_INT && kinds[lv + 2] === T_WORD && dict.vals[lv + 2] === 'R';
    const length = indirect ? resolveInt(direct, Number(dict.vals[lv + 1])) : direct;
    const dataEnd = dataStart + length;
    if (dataEnd > len) return true;
    let e = dataEnd;
    while (e < len && PDF_CLASS[buf[e]] === 1 && e - dataEnd < 64) { s.spend(1); e++; }
    if (buf.toString('latin1', e, e + 9) !== 'endstream') return true; // the extent is not exact

    const data = buf.subarray(dataStart, dataEnd);
    let inner: Buffer;
    if (filters.length === 0) {
      if (data.length > PDF_MAX_INFLATED_PER_STREAM) return true;
      inner = data; // uncompressed: already in the raw scan, checked again for clarity
    } else {
      // Default finish flush: a truncated or unfinished zlib stream throws, and so does one over the cap.
      inner = zlib.inflateSync(data, { maxOutputLength: PDF_MAX_INFLATED_PER_STREAM });
    }
    total += inner.length;
    if (total > PDF_MAX_INFLATED_TOTAL) return true;
    if (namesActive(inner)) return true;
  }
  return false;
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
