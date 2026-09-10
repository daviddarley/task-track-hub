/**
 * Small typed DOM helpers shared by the popup and options page.
 *
 * These exist mostly to keep `createElement` chains readable. Everything sets
 * text via `textContent` and never `innerHTML`: task titles and workspace names
 * come from third-party APIs and are not ours to trust.
 */

/**
 * Look up an element that the page's own HTML guarantees exists. Throwing is
 * right here — a missing id means the HTML and the script have drifted apart,
 * which is a bug to fix, not a case to handle.
 */
export function requireElement<K extends keyof HTMLElementTagNameMap>(
  id: string,
  tag: K,
): HTMLElementTagNameMap[K];
export function requireElement(id: string): HTMLElement;
export function requireElement(id: string, tag?: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id} — HTML and script are out of sync.`);
  if (tag && found.tagName.toLowerCase() !== tag) {
    throw new Error(`Element #${id} is a <${found.tagName.toLowerCase()}>, expected <${tag}>.`);
  }
  return found;
}

export interface ElementOptions {
  class?: string;
  text?: string;
  title?: string;
  dataset?: Record<string, string | undefined>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.title) node.title = options.title;

  for (const [key, value] of Object.entries(options.dataset ?? {})) {
    if (value !== undefined) node.dataset[key] = value;
  }

  node.append(...children);
  return node;
}

/** Replace an element's children in one call. */
export function replaceChildren(target: HTMLElement, ...children: Node[]): void {
  target.replaceChildren(...children);
}
