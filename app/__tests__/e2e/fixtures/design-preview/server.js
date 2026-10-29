/* Tiny static server for the Designer Portal e2e: plays a design preview. Serves index.html / about.html with the
 * real design-overlay.js, fills the sha meta and the overlay's data-origins, and sets the frame-ancestors header
 * for the Citadel origin only (the same shape the Wright _headers.njk renders for a preview build).
 *
 * Library: const { startPreviewServer } = require('./server'); CLI: PW_PORT=3100 node server.js [port]
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/about.html': ['about.html', 'text/html; charset=utf-8'],
  '/assets/js/design-overlay.js': ['design-overlay.js', 'text/javascript; charset=utf-8'],
};

function startPreviewServer(opts) {
  const portalOrigin = opts.portalOrigin;
  let sha = opts.sha || '0000000';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    const hit = FILES[url.pathname];
    if (!hit) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    let body = fs.readFileSync(path.join(DIR, hit[0]), 'utf8');
    body = body.replace(/__SHA__/g, sha).replace(/__ORIGINS__/g, portalOrigin);
    res.writeHead(200, {
      'content-type': hit[1],
      'content-security-policy': `frame-ancestors ${portalOrigin}`,
      'cache-control': 'no-store',
    });
    res.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port || 0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        port: addr.port,
        setSha: (s) => { sha = s; },
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

module.exports = { startPreviewServer };

if (require.main === module) {
  const pwPort = process.env.PW_PORT || '3000';
  const port = Number(process.argv[2] || process.env.DP_PREVIEW_PORT || Number(pwPort) + 1);
  startPreviewServer({ port, portalOrigin: `http://localhost:${pwPort}`, sha: process.env.DP_PREVIEW_SHA || 'c0ffee0' }).then((s) => {
    console.log(`design preview fixture on http://127.0.0.1:${s.port} (frame-ancestors http://localhost:${pwPort})`);
  });
}
