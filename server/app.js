import { createServer } from 'node:http';
import { createApi } from './api.js';
import { HttpError, createStaticHandler, isReply, readJson, sendJson } from './http.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Creates the HTTP server (not listening yet): the REST API under /api and
 * the web UI (static files of `clientDir`) everywhere else.
 */
export function createApp({ catalog, store, clientDir, rng, secureCookies = false, log = console }) {
  const api = createApi({ catalog, store, rng, secureCookies });
  const serveStatic = createStaticHandler(clientDir);

  return createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      sendJson(req, res, 400, { error: 'Malformed URL' });
      return;
    }
    const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');

    try {
      if (!isApi) {
        await serveStatic(req, res, url.pathname);
        return;
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }
      const route = api.match(req.method, url.pathname);
      if (!route) throw new HttpError(404, `No API route ${req.method} ${url.pathname}`);
      if (route.allowed) {
        throw new HttpError(405, `Method ${req.method} not allowed here. Allowed: ${route.allowed.join(', ')}`);
      }
      let body = {};
      if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
        // Requiring JSON blocks cross-site HTML forms from using the session cookie (CSRF).
        if (!(req.headers['content-type'] ?? '').includes('application/json')) {
          throw new HttpError(415, 'Send a JSON body with "Content-Type: application/json"');
        }
        body = await readJson(req);
      }
      const result = await route.handler({ req, params: route.params, query: url.searchParams, body });
      if (isReply(result)) sendJson(req, res, result.status, result.data, { ...CORS_HEADERS, ...result.headers });
      else sendJson(req, res, 200, result, CORS_HEADERS);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) log.error(err);
      const message = status === 500 ? 'Internal server error' : err.message;
      if (res.headersSent) {
        res.destroy();
      } else if (isApi) {
        const payload = { error: message, ...(err.code && { code: err.code }), ...(err.details && { details: err.details }) };
        sendJson(req, res, status, payload, CORS_HEADERS);
      } else {
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`${status} ${message}`);
      }
    }
  });
}
