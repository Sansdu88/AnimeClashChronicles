/**
 * Minimal HTTP toolkit on top of node:http: router, JSON helpers and a static
 * file server. Keeps the project free of dependencies (no npm install needed).
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

/** `code` is a stable identifier the UI uses to show a translated message. */
export class HttpError extends Error {
  constructor(status, message, details, code) {
    super(message);
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

/** Lets a handler choose the status code and headers: `return reply(201, player, { 'Set-Cookie': … })`. */
class Reply {
  constructor(status, data, headers) {
    this.status = status;
    this.data = data;
    this.headers = headers ?? {};
  }
}
export const reply = (status, data, headers) => new Reply(status, data, headers);
export const isReply = (value) => value instanceof Reply;

export function createRouter() {
  const routes = [];
  const add = (method) => (pattern, handler) => {
    const keys = [];
    const source = pattern.replace(/:(\w+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
    routes.push({ method, regex: new RegExp(`^${source}/?$`), keys, handler });
  };

  return {
    get: add('GET'),
    post: add('POST'),
    patch: add('PATCH'),
    delete: add('DELETE'),
    routes,
    /** → { handler, params } when found, { allowed } when only the method is wrong, else null. */
    match(method, pathname) {
      const allowed = [];
      for (const route of routes) {
        const found = route.regex.exec(pathname);
        if (!found) continue;
        if (route.method !== method && !(method === 'HEAD' && route.method === 'GET')) {
          allowed.push(route.method);
          continue;
        }
        const params = {};
        route.keys.forEach((key, i) => {
          try {
            params[key] = decodeURIComponent(found[i + 1]);
          } catch {
            throw new HttpError(400, `Malformed URL parameter "${key}"`);
          }
        });
        return { handler: route.handler, params };
      }
      return allowed.length ? { allowed } : null;
    },
  };
}

export async function readJson(req, limit = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'The request body must be a JSON object');
  }
  return body;
}

export function sendJson(req, res, status, data, headers = {}) {
  let body = status === 204 ? '' : JSON.stringify(data);
  // Big answers (the card list is a few MB) are gzipped: about 4 times smaller.
  const gzip = body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
  if (gzip) body = gzipSync(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...(gzip && { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' }),
    ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

// Pictures come from Wikimedia, fonts from Google Fonts; everything else is local (the
// silent sound that lets old iPhones play the game's sound in silent mode is a blob the page makes).
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data: https://*.wikimedia.org",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
].join('; ');

const statOrNull = (file) => stat(file).catch(() => null);

/** Serves the files of `root`; unknown extension-less paths get index.html (SPA). */
export function createStaticHandler(root) {
  const rootDir = resolve(root);

  return async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      throw new HttpError(400, 'Malformed path');
    }
    if (decoded.includes('\0')) throw new HttpError(400, 'Malformed path');

    let file = resolve(rootDir, `.${decoded}`);
    if (file !== rootDir && !file.startsWith(rootDir + sep)) throw new HttpError(403, 'Forbidden');

    let info = await statOrNull(file);
    if (info?.isDirectory()) {
      file = join(file, 'index.html');
      info = await statOrNull(file);
    }
    if (!info?.isFile()) {
      if (extname(decoded)) throw new HttpError(404, 'Not found');
      file = join(rootDir, 'index.html');
      info = await statOrNull(file);
      if (!info?.isFile()) throw new HttpError(404, 'Not found');
    }

    const type = MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': type,
      'Cache-Control': 'no-cache',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
    if (type.startsWith('text/html')) headers['Content-Security-Policy'] = CONTENT_SECURITY_POLICY;

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': info.size });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    await new Promise((done) => {
      const stream = createReadStream(file);
      stream.on('error', () => {
        res.destroy();
        done();
      });
      stream.on('end', done);
      stream.pipe(res);
    });
  };
}
