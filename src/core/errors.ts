/**
 * Adapter failures are classified so the UI can say something useful — "your
 * token expired, go re-enter it" reads very differently from "ClickUp is down".
 */
export type AdapterErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'timeout'
  | 'not_configured'
  | 'unknown';

export interface AdapterErrorOptions {
  source?: string;
  status?: number;
  cause?: unknown;
}

export class AdapterError extends Error {
  override readonly name = 'AdapterError';
  readonly kind: AdapterErrorKind;
  readonly status: number | null;
  source: string | null;

  constructor(kind: AdapterErrorKind, message: string, options: AdapterErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.kind = kind;
    this.source = options.source ?? null;
    this.status = options.status ?? null;
  }
}

/**
 * Turn anything thrown inside an adapter into an `AdapterError`, so `sync` only
 * ever has one error shape to reason about.
 */
export function toAdapterError(err: unknown, source: string): AdapterError {
  if (err instanceof AdapterError) {
    if (!err.source) err.source = source;
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);
  // `fetch` rejects with a TypeError for DNS failures, offline, blocked hosts.
  const kind: AdapterErrorKind = err instanceof TypeError ? 'network' : 'unknown';
  return new AdapterError(kind, message, { source, cause: err });
}

/** Short, user-facing explanation for a failure kind. */
export function describeErrorKind(kind: AdapterErrorKind, displayName: string): string {
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
    case 'unknown':
      return `${displayName} returned an unexpected error.`;
  }
}
