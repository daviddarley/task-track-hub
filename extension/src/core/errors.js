/**
 * Adapter failures are classified so the UI can say something useful — "your
 * token expired, go re-enter it" reads very differently from "ClickUp is down".
 *
 * @typedef {'auth' | 'rate_limit' | 'network' | 'timeout' | 'not_configured' | 'unknown'} AdapterErrorKind
 */

export class AdapterError extends Error {
  /**
   * @param {AdapterErrorKind} kind
   * @param {string} message
   * @param {{ source?: string, status?: number, cause?: unknown }} [options]
   */
  constructor(kind, message, options = {}) {
    super(message);
    this.name = 'AdapterError';
    /** @type {AdapterErrorKind} */
    this.kind = kind;
    this.source = options.source ?? null;
    this.status = options.status ?? null;
    this.cause = options.cause ?? null;
  }
}

/**
 * Turn anything thrown inside an adapter into an AdapterError so `sync` only
 * ever has one error shape to reason about.
 *
 * @param {unknown} err
 * @param {string} source
 * @returns {AdapterError}
 */
export function toAdapterError(err, source) {
  if (err instanceof AdapterError) {
    if (!err.source) err.source = source;
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  // `fetch` rejects with a TypeError for DNS failures, offline, blocked hosts.
  const kind = err instanceof TypeError ? 'network' : 'unknown';
  return new AdapterError(kind, message, { source, cause: err });
}

/**
 * Short, user-facing explanation for a failure kind.
 *
 * @param {AdapterErrorKind} kind
 * @param {string} displayName
 * @returns {string}
 */
export function describeErrorKind(kind, displayName) {
  switch (kind) {
    case 'auth':
      return `${displayName} rejected the saved credentials. Re-enter them in Options.`;
    case 'rate_limit':
      return `${displayName} is rate limiting us. Try a longer refresh interval.`;
    case 'network':
      return `Could not reach ${displayName}. Check your connection.`;
    case 'timeout':
      return `${displayName} took too long to respond.`;
    case 'not_configured':
      return `${displayName} is not connected yet.`;
    default:
      return `${displayName} returned an unexpected error.`;
  }
}
