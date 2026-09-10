import { clickUpAdapter } from './clickup.js';

/** @typedef {import('../core/types.js').TaskAdapter} TaskAdapter */

/**
 * The registry. Adding a source is: write one file implementing `TaskAdapter`,
 * import it, add it to this array. Nothing in `core/`, the popup, or the
 * storage schema changes.
 *
 * Array order is the display order in the popup and options page.
 *
 * @type {TaskAdapter[]}
 */
export const adapters = [clickUpAdapter];

/**
 * @param {string} id
 * @returns {TaskAdapter | undefined}
 */
export function getAdapter(id) {
  return adapters.find((adapter) => adapter.id === id);
}

/**
 * @param {string} id
 * @returns {string}
 */
export function displayNameFor(id) {
  return getAdapter(id)?.displayName ?? id;
}

/**
 * @returns {string[]}
 */
export function adapterIds() {
  return adapters.map((adapter) => adapter.id);
}
