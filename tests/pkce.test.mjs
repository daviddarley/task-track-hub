// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { challengeFor, createPkcePair, createState, createVerifier } from '../dist/core/pkce.js';

/** RFC 7636 §4.1 — the unreserved set a verifier may draw from. */
const UNRESERVED = /^[A-Za-z0-9\-._~]+$/;

describe('challengeFor', () => {
  it('matches the RFC 7636 Appendix B test vector', async () => {
    // If this fails, the implementation disagrees with the spec itself, not
    // just with our expectations — every other test here would still pass.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    assert.equal(await challengeFor(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('produces url-safe, unpadded output', async () => {
    const challenge = await challengeFor(createVerifier());
    assert.match(challenge, UNRESERVED);
    assert.ok(!challenge.includes('='), 'must not be padded');
    assert.ok(!challenge.includes('+') && !challenge.includes('/'), 'must use the url-safe alphabet');
  });

  it('is deterministic for a given verifier', async () => {
    const verifier = createVerifier();
    assert.equal(await challengeFor(verifier), await challengeFor(verifier));
  });
});

describe('createVerifier', () => {
  it('is within the length the RFC allows', () => {
    const verifier = createVerifier();
    assert.ok(verifier.length >= 43, `too short: ${verifier.length}`);
    assert.ok(verifier.length <= 128, `too long: ${verifier.length}`);
  });

  it('uses only unreserved characters', () => {
    assert.match(createVerifier(), UNRESERVED);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => createVerifier()));
    assert.equal(seen.size, 200, 'verifiers must be unique');
  });
});

describe('createPkcePair', () => {
  it('returns a verifier with its matching challenge', async () => {
    const pair = await createPkcePair();
    assert.equal(pair.method, 'S256');
    assert.equal(pair.challenge, await challengeFor(pair.verifier));
    assert.notEqual(pair.challenge, pair.verifier, 'the challenge must not be the verifier');
  });
});

describe('createState', () => {
  it('is url-safe and unique', () => {
    assert.match(createState(), UNRESERVED);
    const seen = new Set(Array.from({ length: 200 }, () => createState()));
    assert.equal(seen.size, 200);
  });
});
