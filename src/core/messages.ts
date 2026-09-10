/**
 * The popup and options page never call an external API themselves — they ask
 * the background worker to. This module is the shared vocabulary for that.
 */

import type { Snapshot } from './types.js';

export type Message =
  | { type: 'refresh' }
  | { type: 'reschedule' }
  | { type: 'connect'; adapterId: string };

/**
 * What each message resolves to. Keyed by `Message['type']` so `sendMessage`
 * can give the caller the right return type without a cast at every call site.
 */
export interface MessageResponses {
  refresh: Snapshot;
  reschedule: { refreshMinutes: number };
  connect: Snapshot;
}

export type ResponseFor<M extends Message> = MessageResponses[M['type']];

/**
 * Errors don't survive `chrome.runtime.sendMessage` — it structured-clones the
 * payload, and a rejected promise on the worker side just becomes silence. So
 * the worker always resolves with this envelope and the caller re-throws.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export async function sendMessage<M extends Message>(message: M): Promise<ResponseFor<M>> {
  const response = (await chrome.runtime.sendMessage(message)) as Result<ResponseFor<M>> | undefined;

  if (!response) throw new Error('The background worker did not respond.');
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
