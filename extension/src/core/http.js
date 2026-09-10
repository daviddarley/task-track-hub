import { AdapterError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * `fetch` + JSON + a timeout + HTTP status mapped onto `AdapterError` kinds.
 *
 * Only ever called from the background service worker. Manifest V3 workers may
 * make cross-origin requests to hosts declared in `host_permissions`; content
 * scripts may not, which is why no adapter is importable from page context.
 *
 * @param {string} url
 * @param {{
 *   method?: string,
 *   headers?: Record<string, string>,
 *   body?: unknown,
 *   timeoutMs?: number,
 *   source: string,
 * }} options
 * @returns {Promise<any>}
 */
export async function requestJson(url, options) {
  const { method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS, source } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  /** @type {Response} */
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new AdapterError('timeout', `Request to ${hostOf(url)} timed out.`, { source, cause: err });
    }
    throw new AdapterError('network', `Request to ${hostOf(url)} failed.`, { source, cause: err });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new AdapterError(kindForStatus(response.status), await errorMessage(response), {
      source,
      status: response.status,
    });
  }

  try {
    return await response.json();
  } catch (err) {
    throw new AdapterError('unknown', `${hostOf(url)} returned a non-JSON response.`, { source, cause: err });
  }
}

/**
 * @param {number} status
 * @returns {import('./errors.js').AdapterErrorKind}
 */
function kindForStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'network';
  return 'unknown';
}

/**
 * Pull whatever the API is willing to tell us out of an error body, without
 * letting a huge HTML error page into storage.
 *
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function errorMessage(response) {
  let detail = '';
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.err ?? parsed?.error ?? parsed?.message ?? '';
    } catch {
      detail = text;
    }
  } catch {
    /* body already consumed or unreadable — status alone will have to do */
  }
  detail = String(detail).replace(/\s+/g, ' ').trim().slice(0, 200);
  return detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`;
}

/**
 * @param {string} url
 * @returns {string}
 */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
