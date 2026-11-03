/** Create an element with a class and optional inner HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
}

const last = new WeakMap<Element, string>();

/** Set text only when it changed (cheap to call every frame). */
export function setText(el: Element, text: string): void {
  if (last.get(el) === text) return;
  last.set(el, text);
  el.textContent = text;
}

/** Set inner HTML only when it changed. */
export function setHtml(el: Element, html: string): void {
  if (last.get(el) === html) return;
  last.set(el, html);
  el.innerHTML = html;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
