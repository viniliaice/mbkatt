/**
 * Static server for the production build.
 *
 * The application is entirely client-side: this server only hands out the
 * built assets and never receives, stores or forwards any uploaded file.
 * There is no API and no database — that is intentional (see the Privacy page).
 *
 *   npm run build && npm start
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const distDir = resolve(here, '..', 'dist');
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

if (!existsSync(distDir)) {
  console.error(`[mbk] The build directory "${distDir}" does not exist. Run "npm run build" first.`);
  process.exit(1);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // Everything runs locally; no third-party origins are used by the app.
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' blob:",
      "object-src 'none'",
      "frame-ancestors https://*.e2b.app",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
    ...headers,
  });
  res.end(body);
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    // Only GET/HEAD are needed for a static app.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Method not allowed');
      return;
    }

    const requested = decodeURIComponent(url.pathname);
    const safePath = normalize(requested).replace(/^([/\\])+/, '');
    let filePath = resolve(distDir, safePath);

    // Never serve anything outside dist/.
    if (filePath !== distDir && !filePath.startsWith(distDir + sep)) {
      send(res, 403, 'Forbidden');
      return;
    }

    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      const indexCandidate = join(filePath, 'index.html');
      if (existsSync(indexCandidate) && statSync(indexCandidate).isFile()) {
        filePath = indexCandidate;
      } else {
        // Single-page app: unknown non-asset routes fall back to index.html.
        if (extname(requested) === '') {
          filePath = join(distDir, 'index.html');
        } else {
          send(res, 404, 'Not found');
          return;
        }
      }
    }

    const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Content-Length': statSync(filePath).size,
      // Hashed assets can be cached; index.html must not be.
      'Cache-Control': filePath.includes(`${sep}assets${sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    };

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    res.writeHead(200, {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self' blob:",
        "object-src 'none'",
        "frame-ancestors https://*.e2b.app",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
      ...headers,
    });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error('[mbk] request failed:', error);
    send(res, 500, 'Internal error');
  }
});

server.listen(port, host, () => {
  console.log(`[mbk] MBK Attendance Audit is available on http://${host}:${port}`);
  console.log('[mbk] Static files only — uploads never leave the browser.');
});
