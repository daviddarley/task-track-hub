import { AdapterError, type AdapterErrorKind } from './errors.js';

const DEFAULT_TIMEOUT_MS = 20_000;

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  /** JSON request body. Mutually exclusive with `form`. */
  body?: unknown;
  /**
   * Form-encoded request body. OAuth 2.0 token endpoints require
   * `application/x-www-form-urlencoded` and reject JSON.
   */
  form?: Record<string, string>;
  timeoutMs?: number;
  /** Adapter id, so a failure can be attributed to the right source. */
  source: string;
}

/**
 * `fetch` + JSON + a timeout + HTTP status mapped onto `AdapterError` kinds.
 *
 * Only ever called from the background service worker. Manifest V3 workers may
 * make cross-origin requests to hosts declared in `host_permissions`; content
 * scripts may not, which is why no adapter is importable from page context.
 *
 * The return type is `unknown` on purpose: an HTTP response is untyped data
 * until an adapter narrows it, and pretending otherwise is how `undefined`
 * ends up in storage.
 */
export async function requestJson(url: string, options: RequestOptions): Promise<unknown> {
  const { method = 'GET', headers = {}, body, form, timeoutMs = DEFAULT_TIMEOUT_MS, source } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const init: RequestInit = { method, headers, signal: controller.signal };
  if (form !== undefined) {
    init.body = new URLSearchParams(form).toString();
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded', ...headers };
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json', ...headers };
  }

  let response: Response;
  try {
    response = await fetch(url, init);
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
    return (await response.json()) as unknown;
  } catch (err) {
    throw new AdapterError('unknown', `${hostOf(url)} returned a non-JSON response.`, { source, cause: err });
  }
}

function kindForStatus(status: number): AdapterErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'network';
  return 'unknown';
}

/**
 * Pull whatever the API is willing to tell us out of an error body, without
 * letting a huge HTML error page into storage.
 */
async function errorMessage(response: Response): Promise<string> {
  let detail = '';
  try {
    const text = await response.text();
    try {
      const parsed: unknown = JSON.parse(text);
      detail = readErrorField(parsed) ?? text;
    } catch {
      detail = text;
    }
  } catch {
    /* body already consumed or unreadable — the status alone will have to do */
  }

  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 200);
  return detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`;
}

/** APIs disagree about which key holds the message; try the common ones. */
function readErrorField(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  for (const key of ['err', 'error', 'message', 'detail']) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
