/** Thin wrapper around fetch() for the Anime Clash Chronicles REST API. */

class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function failed(error, path) {
  // The session expired while playing: the app goes back to the login screen.
  if (error.code === 'not_authenticated' && !path.startsWith('/auth/')) {
    window.dispatchEvent(new CustomEvent('mb:unauthorized'));
  }
  return error;
}

export async function api(path, { method = 'GET', body } = {}) {
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
