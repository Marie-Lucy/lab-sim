import { getLanguage, LANGS, onLanguageChange, setLanguage, t, type Lang } from '../i18n';
import { h } from './dom';

/** Segmented ES · PT · EN buttons (start screen). */
export function createLangToggle(): HTMLElement {
  const el = h('div', 'lang-toggle');
  el.setAttribute('role', 'group');
  for (const l of LANGS) {
    const b = h('button', '', l.short);
    b.type = 'button';
    b.title = l.name;
    b.lang = l.locale;
    b.dataset.lang = l.id;
    b.addEventListener('click', () => setLanguage(l.id, true));
    el.appendChild(b);
  }
  const sync = (lang: Lang) => {
    el.setAttribute('aria-label', t('lang.label'));
    el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.lang === lang);
      b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    });
  };
  sync(getLanguage());
  onLanguageChange(sync);
  return el;
}

/** Compact select (HUD top bar), readable on narrow screens. */
export function createLangSelect(): HTMLSelectElement {
  const el = h('select', 'chip lang-select');
  for (const l of LANGS) {
    // Short codes keep the closed select compact on phones; the full name is the tooltip.
    const o = h('option', '', l.short);
    o.value = l.id;
    o.title = l.name;
    o.lang = l.locale;
    el.appendChild(o);
  }
  el.value = getLanguage();
  el.addEventListener('change', () => setLanguage(el.value as Lang, true));
  const sync = (lang: Lang) => {
    el.value = lang;
    el.title = t('lang.label');
    el.setAttribute('aria-label', t('lang.label'));
  };
  sync(getLanguage());
  onLanguageChange(sync);
  return el;
}
