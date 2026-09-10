import type { TaskAdapter } from '../core/types.js';
import { clickUpAdapter } from './clickup.js';
import { netSuiteAdapter } from './netsuite.js';

/**
 * The registry. Adding a source is: write one file implementing `TaskAdapter`,
 * import it, add it to this array. Nothing in `core/`, the popup, or the
 * storage schema changes.
 *
 * Array order is the display order in the popup and options page.
 */
export const adapters: readonly TaskAdapter[] = [clickUpAdapter, netSuiteAdapter];

export function getAdapter(id: string): TaskAdapter | undefined {
  return adapters.find((adapter) => adapter.id === id);
}

/** Falls back to the raw id so a task from a retired adapter still renders. */
export function displayNameFor(id: string): string {
  return getAdapter(id)?.displayName ?? id;
}

export function adapterIds(): string[] {
  return adapters.map((adapter) => adapter.id);
}
