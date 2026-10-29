/* In-memory stand-in for S3 (path-style PUT/GET/HEAD) so the Designer Portal e2e never touches a real bucket.
 * The Citadel dev server is pointed at it with AWS_ENDPOINT_URL_S3 (see playwright.config.ts, isolated mode).
 * CLI: node fake-s3.js <port> */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS fixture run as a plain node script (uses __dirname / require.main)
const http = require('node:http');

const objects = new Map();

/** Decode an aws-chunked body ("<hex>;chunk-signature=..\r\n<data>\r\n ... 0\r\n<trailers>") if the SDK sent one. */
function decodeAwsChunked(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const eol = buf.indexOf('\r\n', i);
    if (eol < 0) break;
    const size = parseInt(buf.slice(i, eol).toString('latin1').split(';')[0], 16);
    if (!Number.isFinite(size) || size === 0) break;
    out.push(buf.subarray(eol + 2, eol + 2 + size));
    i = eol + 2 + size + 2;
  }
  return Buffer.concat(out);
}

const server = http.createServer((req, res) => {
  const key = decodeURIComponent((req.url || '/').split('?')[0]);
  if (key === '/' || key === '/__health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (req.method === 'PUT') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = Buffer.concat(chunks);
      if (String(req.headers['content-encoding'] || '').includes('aws-chunked') || req.headers['x-amz-content-sha256'] === 'STREAMING-UNSIGNED-PAYLOAD-TRAILER') body = decodeAwsChunked(body);
      objects.set(key, { body, type: String(req.headers['content-type'] || 'application/octet-stream') });
      res.writeHead(200, { etag: '"fake-etag"' });
      res.end();
    });
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    const o = objects.get(key);
    if (!o) {
      res.writeHead(404, { 'content-type': 'application/xml' });
      res.end('<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>missing</Message></Error>');
      return;
    }
    res.writeHead(200, { 'content-type': o.type, 'content-length': o.body.length, etag: '"fake-etag"' });
    res.end(req.method === 'HEAD' ? undefined : o.body);
    return;
  }
  res.writeHead(405);
  res.end();
});

server.listen(Number(process.argv[2] || 3102), '127.0.0.1', () => console.log('fake s3 up'));
