// Ported from the chat daemon (/home/mike/.claude/tools/bast-chat/src/tools/scrub.ts) for the card conversation read, plus the shapes added
// here (a pasted pull URL with its bare key on the next line, "pw hunter2"). Linear in the length of the text, like the original.
// The secret scrubber, as pure text functions with no imports (so a worker thread can load it in a few milliseconds).
//
// Every pattern here is LINEAR in the length of the text (Mike's chat daemon runs this on the main thread over files of any
// size, so one super-linear pattern stops every chat and the heartbeat; a 160 KB base64 file once took 40 s). The rules that
// keep it linear:
//   * no unbounded quantifier in front of the part that decides a match (names are `{0,64}`, schemes `{0,30}`);
//   * anything that has to find a word first (a credential name, `://`, `eyJ`) finds it with a plain scan, looks a bounded
//     distance around it, and jumps past what it used, so no start position is ever re-scanned;
//   * the regexes that remain are anchored on a literal prefix with a fixed minimum length and no trailing condition, so a
//     failed attempt costs at most the minimum length.
// test/local-guard.test.ts times each shape on 1 MB of input.

export const SECRET_REMOVED = '[secret removed]';
/** What a redacted turn's text is replaced with (POST /api/bast-chat/worker/conversations/:id/redact). */
export const REDACTED_TURN_TEXT = '[connection info received]';

// ---------------------------------------------------------------- name rules

const STRONG_NAME = /key|secret|token|passw|passphrase|passcode|pwd|credential|auth|salt|bearer|private|signature/;
/** A name that has "pass" or "pw" as its own word: DB_PASS, pass, pw, user-pw. */
const WEAK_NAME = /(?:^|[^a-z])(?:pass|pw)(?:$|[^a-z])/;
/** camelCase: dbPass, adminPw. */
const WEAK_CAMEL = /[a-z](?:Pass|Pw)(?![a-z])/;
/** Names that contain a credential word but are ordinary words. */
const NOT_A_CREDENTIAL = /^(?:keywords?|keyphrases?|keyword[-_ ]?\w*|authors?|authority|authoring|monkey|turkey|donkey|hockey|keyboard|keynote|keyframes?|key[-_ ](?:points?|takeaways?|features?|findings|dates?|metrics?|phrases?|terms?|messages?|benefits?|facts?))$/;

function sensitiveName(name: string): boolean {
  const n = name.toLowerCase();
  if (NOT_A_CREDENTIAL.test(n)) return false;
  return STRONG_NAME.test(n) || WEAK_NAME.test(n) || WEAK_CAMEL.test(name);
}

// character classes by code
const isNameCh = (c: number): boolean => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 46 || c === 45;
const isB64Ch = (c: number): boolean => isNameCh(c) || c === 43 || c === 47 || c === 61;
const isSpace = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12;
const isStopCh = (c: number): boolean => c === 10 || c === 13 || c === 44 || c === 59 || c === 41 || c === 125 || c === 93;
const HASHISH = /\b(?:sha\d*|md5|hash|checksum|commit|digest|etag|integrity)\b/i;

// ---------------------------------------------------------------- key blocks

/** `-----BEGIN ... PRIVATE KEY-----` to its END line, or to the end of the text when the block is cut. The header may be split over lines. */
const KEY_BLOCK = /-----BEGIN[A-Z0-9 \r\n]{0,60}?P\s{0,3}R\s{0,3}I\s{0,3}V\s{0,3}A\s{0,3}T\s{0,3}E\s{0,3}KEY(?: BLOCK)?-----[\s\S]*?(?:-----END[A-Z0-9 \r\n]{0,60}?KEY(?: BLOCK)?-----|$)/g;

/** Only the key blocks: cheap enough to run over a whole file before a window of it is cut out. */
export function scrubKeyBlocks(text: string): { text: string; removed: number } {
  if (!text.includes('-----BEGIN')) return { text, removed: 0 };
  let removed = 0;
  const t = text.replace(KEY_BLOCK, () => {
    removed++;
    return SECRET_REMOVED;
  });
  return { text: t, removed };
}

// ---------------------------------------------------------------- name = value

const HIT = /key|secret|token|pass|pw|credential|auth|salt|bearer|private|signature/gi;
const BARE_HEAD = /^[\s"':=>-]{1,8}(?:(?:is|was)\s+)?["']?/;

/** NAME = value, NAME: value, "name": "value", 'name' => 'value', define('NAME', 'value'), and a bare long hex or base64 value after a credential word. */
function scrubAssignments(text: string, mark: () => string): string {
  const len = text.length;
  let out = '';
  let last = 0;
  let pos = 0;
  for (;;) {
    HIT.lastIndex = pos;
    const m = HIT.exec(text);
    if (!m) break;
    const hitStart = m.index;
    const hitEnd = hitStart + m[0].length;
    let s = hitStart;
    const sMin = Math.max(last, hitStart - 64);
    while (s > sMin && isNameCh(text.charCodeAt(s - 1))) s--;
    let e = hitEnd;
    const eMax = Math.min(len, hitEnd + 64);
    while (e < eMax && isNameCh(text.charCodeAt(e))) e++;
    const name = text.slice(s, e);
    if (!sensitiveName(name)) {
      pos = e;
      continue;
    }
    let i = e;
    const q = text.charCodeAt(i);
    if (q === 34 || q === 39) i++;
    let w = 0;
    while (w < 40 && i < len && isSpace(text.charCodeAt(i))) {
      i++;
      w++;
    }
    // `define('NAME', 'value')`: the comma is the operator.
    let opLen = 0;
    let viaComma = false;
    if (text.startsWith('=>', i)) opLen = 2;
    else if (text.charCodeAt(i) === 58) opLen = 1;
    else if (text.charCodeAt(i) === 61 && text.charCodeAt(i + 1) !== 61) opLen = 1;
    else if (text.charCodeAt(i) === 44 && /define\(\s*["'][^"'\n]{0,80}$/i.test(text.slice(Math.max(0, s - 90), e))) {
      opLen = 1;
      viaComma = true;
    }
    if (opLen) {
      i += opLen;
      w = 0;
      while (w < 40 && i < len && isSpace(text.charCodeAt(i))) {
        i++;
        w++;
      }
      let j = i;
      const c = text.charCodeAt(i);
      if (c === 34 || c === 39) {
        // a quoted value ends at its closing quote on the same line
        let k = i + 1;
        while (k < len && text.charCodeAt(k) !== c && text.charCodeAt(k) !== 10) k++;
        j = k < len && text.charCodeAt(k) === c ? k + 1 : i;
      }
      if (j === i) {
        if (c === 123 || c === 91) {
          pos = e;
          continue; // an object or list opens here; its members are checked on their own
        }
        while (j < len && !isStopCh(text.charCodeAt(j))) j++;
        while (j > i && isSpace(text.charCodeAt(j - 1))) j--;
      }
      if (j > i && !text.slice(i, j).includes(SECRET_REMOVED)) {
        const quote = viaComma && (c === 34 || c === 39) ? text[i]! : '';
        out += text.slice(last, i) + quote + mark() + quote;
        last = j;
        pos = j;
        continue;
      }
      pos = Math.max(e, j);
      continue;
    }
    // a bare long value after a credential word: `secret 5f4dc3...`, `token is abc...`
    const head = BARE_HEAD.exec(text.slice(e, e + 24));
    if (head) {
      const k = e + head[0].length;
      let r = k;
      while (r < len && isB64Ch(text.charCodeAt(r))) r++;
      const run = text.slice(k, r);
      if (run.length >= 32 && /[A-Za-z]/.test(run) && (/\d/.test(run) || /^[0-9a-f]+$/i.test(run)) && !HASHISH.test(text.slice(Math.max(0, s - 24), e)) && !run.includes(SECRET_REMOVED)) {
        out += text.slice(last, k) + mark();
        last = r;
        pos = r;
        continue;
      }
    }
    pos = e;
  }
  return out + text.slice(last);
}

// ---------------------------------------------------------------- the other shapes

const BEARER = /\b(Bearer|Basic)\s{1,20}[A-Za-z0-9._~+/=-]{12,}/g;
/** XML: <password>value</password>, <apiKey>value</apiKey>. */
const XML_PAIR = /<([A-Za-z_][\w.-]{0,40})>([^<>]{1,300})<\/\1>/g;
/** `--password hunter2`, `--token abc`, `-p hunter2` after sshpass. */
const FLAG_VALUE = /(--(?:password|passwd|pass|pwd|passphrase|token|secret|api-?key|auth|access-?key|secret-?key|client-?secret)[ \t]{1,5})(?!-)[^\s'"]{1,200}|(["']?)(\bsshpass\b[^\n]{0,60}?[ \t]-p[ \t]{1,5})[^\s]{1,200}/gi;
/** mysql -uroot -pSecret: `-p` glued to its value, only on a line that runs a database client. */
const GLUED_P = /(^|[ \t])(-p)(?![ \t=])([^\s]{1,100})/gm;
const DB_CLIENT = /mysql|mariadb|mysqldump|mysqladmin|mysqlcheck|mysqlimport|mysqlshow|dbpass/i;
const KNOWN_TOKENS = new RegExp(
  [
    'sk-ant-[A-Za-z0-9_-]{16,}',
    'sk-[A-Za-z0-9_-]{16,}',
    '(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}',
    'whsec_[A-Za-z0-9]{10,}',
    'GOCSPX-[A-Za-z0-9_-]{16,}',
    '(?<![A-Za-z0-9_])key-[0-9a-zA-Z]{32}',
    '(?<![A-Za-z0-9_])(?:SK|AC)[0-9a-fA-F]{32}',
    'gh[pousr]_[A-Za-z0-9]{20,}',
    'github_pat_[A-Za-z0-9_]{20,}',
    'xox[abprs]-[A-Za-z0-9-]{10,}',
    'AKIA[0-9A-Z]{16}[\\s"\',:=]{1,10}[A-Za-z0-9/+=]{40}',
    'AKIA[0-9A-Z]{16}',
    'ASIA[0-9A-Z]{16}',
    'AIza[A-Za-z0-9_-]{30,}',
    'ya29\\.[A-Za-z0-9_-]{20,}',
    'glpat-[A-Za-z0-9_-]{16,}',
    'npm_[A-Za-z0-9]{30,}',
    'dop_v1_[a-f0-9]{40,}',
    'shpat_[a-f0-9]{20,}',
    'SG\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}',
  ].join('|'),
  'g',
);
const LONG_MIXED = /[A-Za-z0-9+/_=-]{40,}/g;

function looksLikeSecretRun(s: string): boolean {
  if (/^[0-9a-f]{40}$|^[0-9a-f]{64}$/i.test(s)) return false; // a git or sha256 hash
  return /[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s);
}

/** user:password@host in a URL, found from `://` outward. Linear: each `://` is looked at once. */
function scrubUrlCreds(text: string, mark: () => string): string {
  let from = text.indexOf('://');
  if (from < 0) return text;
  let out = '';
  let last = 0;
  const len = text.length;
  while (from >= 0) {
    let a = from;
    const min = Math.max(last, from - 31);
    while (a > min && /[A-Za-z0-9+.-]/.test(text[a - 1]!)) a--;
    while (a < from && !/[A-Za-z]/.test(text[a]!)) a++;
    let next = text.indexOf('://', from + 3);
    if (a < from) {
      const uStart = from + 3;
      let u = uStart;
      const uMax = Math.min(len, uStart + 256);
      while (u < uMax && !/[\s/@:]/.test(text[u]!)) u++;
      if (u > uStart && text[u] === ':') {
        const pStart = u + 1;
        let p = pStart;
        const pMax = Math.min(len, pStart + 512);
        while (p < pMax && !/[\s/@]/.test(text[p]!)) p++;
        if (p > pStart && text[p] === '@') {
          out += text.slice(last, uStart) + mark() + '@';
          last = p + 1;
          while (next >= 0 && next < last) next = text.indexOf('://', next + 3);
        }
      }
    }
    from = next;
  }
  return out + text.slice(last);
}

/** A JWT: eyJ... . ... . ..., found by walking the `eyJ` starts and skipping each run that was already examined. */
function scrubJwts(text: string, mark: () => string): string {
  let at = text.indexOf('eyJ');
  if (at < 0) return text;
  let out = '';
  let last = 0;
  const len = text.length;
  const isSeg = (c: number): boolean => isNameCh(c) && c !== 46;
  const segEnd = (from: number): number => {
    let r = from;
    while (r < len && isSeg(text.charCodeAt(r))) r++;
    return r;
  };
  while (at >= 0) {
    const e1 = segEnd(at);
    let advance = e1;
    if (e1 - at >= 13 && text.charCodeAt(e1) === 46) {
      const e2 = segEnd(e1 + 1);
      if (e2 - (e1 + 1) >= 10 && text.charCodeAt(e2) === 46) {
        const e3 = segEnd(e2 + 1);
        if (e3 - (e2 + 1) >= 10) {
          out += text.slice(last, at) + mark();
          last = e3;
          advance = e3;
        }
      }
    }
    at = text.indexOf('eyJ', Math.max(advance, at + 3));
  }
  return out + text.slice(last);
}

/**
 * A WP Migrate style pull: a site URL, then on a line of its own a bare 40-character key (letters and digits only). The key is the secret; the
 * URL stays. The line before may carry the URL with a trailing label. Bounded: the key line is at most 40 characters of one class.
 */
const URL_THEN_KEY = /(https?:\/\/[^\s]{1,300}[ \t]{0,10}\r?\n[ \t]{0,10})([A-Za-z0-9]{40})(?![A-Za-z0-9])/g;
/** "pw hunter2", "password is hunter2", "pwd: hunter2": the word then a short bare value (the longer assignments are handled above). */
const PW_WORD = /(^|[^A-Za-z0-9_])((?:pw|pwd|pass|passwd|password|passphrase)[ \t]{0,3}(?:is|was|:|=)?[ \t]{1,3})(?!(?:reset|change|changed|field|manager|protected|required|link|email|page|please|for|the|and|to|on|in|of|you|your|will|was|is)\b)([^\s,;'"]{4,100})/gi;

/** Replace every secret-shaped value in a text. Names and everything around the value are kept. */
export function scrubSecrets(text: string): { text: string; removed: number } {
  let removed = 0;
  const mark = () => {
    removed++;
    return SECRET_REMOVED;
  };
  let t = text.replace(KEY_BLOCK, mark);
  t = scrubAssignments(t, mark);
  t = t.replace(XML_PAIR, (m: string, name: string, val: string) => (sensitiveName(name) && !val.includes(SECRET_REMOVED) ? `<${name}>${mark()}</${name}>` : m));
  t = t.replace(FLAG_VALUE, (_m: string, flag: string | undefined, q: string | undefined, ssh: string | undefined) => (flag ? flag + mark() : `${q ?? ''}${ssh ?? ''}${mark()}`));
  t = t.replace(GLUED_P, (m: string, pre: string, p: string, val: string, offset: number) => {
    const lineStart = t.lastIndexOf('\n', offset) + 1;
    return DB_CLIENT.test(t.slice(Math.max(lineStart, offset - 240), offset)) ? pre + p + mark() : m;
  });
  t = t.replace(BEARER, (_m, w: string) => `${w} ${mark()}`);
  t = scrubUrlCreds(t, mark);
  t = t.replace(URL_THEN_KEY, (_m: string, head: string) => head + mark());
  t = t.replace(PW_WORD, (m: string, pre: string, word: string, val: string) => (val.includes(SECRET_REMOVED) ? m : pre + word + mark()));
  t = scrubJwts(t, mark);
  t = t.replace(KNOWN_TOKENS, mark);
  t = t.replace(LONG_MIXED, (m) => (looksLikeSecretRun(m) ? mark() : m));
  return { text: t, removed };
}
