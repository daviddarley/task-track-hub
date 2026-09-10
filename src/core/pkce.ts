/**
 * PKCE (RFC 7636) — Proof Key for Code Exchange.
 *
 * A browser extension cannot keep a secret: anyone can unzip it and read the
 * source, so the usual `client_secret` on the token exchange would be secret in
 * name only. PKCE replaces it with a per-request proof — we send the hash of a
 * random value when starting the flow, then the value itself when redeeming the
 * code. An attacker who intercepts the authorization code can't redeem it
 * without the original verifier, which never left the service worker.
 *
 * NetSuite supports this for public clients today, and makes it mandatory for
 * the authorization code grant in release 2027.1.
 */

export interface PkcePair {
  /** Sent on the token exchange. Never leaves the service worker before that. */
  verifier: string;
  /** Sent on the authorization request. Safe to put in a URL. */
  challenge: string;
  method: 'S256';
}

/** RFC 7636 §4.1: 43–128 characters. 32 random bytes encode to exactly 43. */
const VERIFIER_BYTES = 32;

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = createVerifier();
  return { verifier, challenge: await challengeFor(verifier), method: 'S256' };
}

/**
 * Base64url output is drawn entirely from the unreserved character set RFC 7636
 * requires, so encoding random bytes gives a valid verifier with no modulo bias
 * — which picking characters out of an alphabet by index would introduce.
 */
export function createVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES)));
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/**
 * Opaque value echoed back by the authorization server, so we can prove the
 * redirect we received belongs to the request we started.
 */
export function createState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Base64 with the URL-safe alphabet and no padding, per RFC 7636 §A.
 */
function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
