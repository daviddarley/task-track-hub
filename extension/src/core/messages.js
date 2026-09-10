/**
 * The popup and options page never call an external API themselves — they ask
 * the background worker to. This module is the shared vocabulary for that.
 *
 * @typedef {{ type: 'refresh' }
 *   | { type: 'reschedule' }
 *   | { type: 'connect', adapterId: string }} Message
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string }} Result
 */

/**
 * @param {Message} message
 * @returns {Promise<any>}
 */
export async function sendMessage(message) {
  /** @type {Result<any> | undefined} */
  const response = await chrome.runtime.sendMessage(message);
  if (!response) throw new Error('The background worker did not respond.');
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
