/**
 * Thin wrapper around fetch() for the Anime Clash Chronicles REST API.
 * When the page is served without the Node.js server (GitHub Pages), the same
 * routes are answered in the browser by local-api.js.
 */

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let backend = null; // Promise → null (Node.js server) or the local API
let localMode = false;

function getBackend() {
  backend ??= (async () => {
    // `npm run build:pages` marks the page with <meta name="app-mode" content="static">.
    if (document.querySelector('meta[name="app-mode"]')?.content !== 'static') return null;
    const { createLocalApi } = await import('./local-api.js');
    localMode = true;
    return createLocalApi();
  })();
  return backend;
}

/** True when the game runs without its server (data saved in this browser only). */
export const isLocalMode = () => localMode;

function failed(error, path) {
  // The session expired while playing: the app goes back to the login screen.
  if (error.code === 'not_authenticated' && !path.startsWith('/auth/')) {
    window.dispatchEvent(new CustomEvent('mb:unauthorized'));
  }
  return error;
}

export async function api(path, { method = 'GET', body } = {}) {
  const local = await getBackend();
  if (local) {
    try {
      return await local.request(path, { method, body });
    } catch (err) {
      if (err.status === undefined) throw err;
      throw failed(new ApiError(err.status, err.message, err.code), path);
    }
  }

  const sendsBody = method !== 'GET' && method !== 'DELETE';
  let response;
  try {
    response = await fetch(`api${path}`, {
      method,
      headers: sendsBody ? { 'Content-Type': 'application/json' } : {},
      body: sendsBody ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is it still running?', 'network');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw failed(new ApiError(response.status, data?.error ?? `Request failed (${response.status})`, data?.code), path);
  }
  return data;
}
