import en from './en';
import es from './es';
import pt from './pt';
import type { Dictionary, Key } from './types';

export type { Key } from './types';
export type Lang = 'es' | 'pt' | 'en';

export interface LangInfo {
  readonly id: Lang;
  /** Short code shown in the switchers. */
  readonly short: string;
  /** Name in its own language. */
  readonly name: string;
  /** BCP 47 locale used for number formatting and <html lang>. */
  readonly locale: string;
}

/** Spanish and Portuguese are the most spoken languages in Latin America; English as reference. */
export const LANGS: readonly LangInfo[] = [
  { id: 'es', short: 'ES', name: 'Español', locale: 'es-419' },
  { id: 'pt', short: 'PT', name: 'Português', locale: 'pt-BR' },
  { id: 'en', short: 'EN', name: 'English', locale: 'en-US' },
];

export const DICTIONARIES: Readonly<Record<Lang, Dictionary>> = { en, es, pt };

const STORAGE_KEY = 'labtheme.lang';
let current: Lang = 'en';
const listeners = new Set<(lang: Lang) => void>();

export function getLanguage(): Lang {
  return current;
}

export function langInfo(lang: Lang = current): LangInfo {
  return LANGS.find((l) => l.id === lang)!;
}

type Params = Readonly<Record<string, string | number>>;

/** Case values available to every text ({vessel}, {other}, {deg}, {lead}, {where}). */
let context: () => Params = () => ({
  vessel: t('vessel.lad'),
  other: t('vessel.lcx'),
  deg: 0,
  lead: 'V2',
  where: t('where.midLad'),
  cusp: t('cusp.left'),
  otherCusp: t('cusp.right'),
  cuspDeg: 0,
  ostium: t('ostium.left'),
  artery: t('artery.left'),
  entry: t('vessel.lm'),
  side: 'left',
});

/** Set by the session so texts name this patient's target vessel, ECG lead, etc. */
export function setTextContext(fn: () => Params): void {
  context = fn;
}

export function textContext(): Params {
  return context();
}

/** Translate a key, replacing {placeholders} from `params`, then from the case context. */
export function t(key: Key, params?: Params): string {
  let s: string = DICTIONARIES[current][key] ?? en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  if (s.includes('{')) for (const [k, v] of Object.entries(context())) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** For keys built at runtime (e.g. `stage.${id}.title`); unknown keys return the key itself. */
export function tk(key: string, params?: Params): string {
  return t(key as Key, params);
}

export function hasKey(key: string): key is Key {
  return key in en;
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Locale-aware number with a fixed number of decimals (pt-BR uses a decimal comma). */
export function fmt(x: number, digits = 1): string {
  const id = `${current}|${digits}`;
  let f = formatters.get(id);
  if (!f) {
    f = new Intl.NumberFormat(langInfo().locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
    formatters.set(id, f);
  }
  return f.format(x);
}

/** First supported language among stored preference and browser languages (fallback English). */
export function detectLanguage(stored: string | null, browser: readonly string[]): Lang {
  const all = [stored ?? '', ...browser];
  for (const l of all) {
    const base = l.toLowerCase().split(/[-_]/)[0];
    if (base === 'es' || base === 'pt' || base === 'en') return base;
  }
  return 'en';
}

export function readStoredLanguage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setLanguage(lang: Lang, persist = false): void {
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage unavailable: the choice lasts for this session only */
    }
  }
  if (lang === current) return;
  current = lang;
  listeners.forEach((fn) => fn(lang));
}

export function onLanguageChange(fn: (lang: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Fill static markup: [data-i18n] → textContent, [data-i18n-html] → innerHTML (trusted
 * dictionary strings only), [data-i18n-title] → title. Optional JSON params in data-i18n-args.
 */
export function applyI18n(root: ParentNode): void {
  const args = (el: Element) => {
    const a = el.getAttribute('data-i18n-args');
    return a ? (JSON.parse(a) as Record<string, string | number>) : undefined;
  };
  root.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = tk(el.getAttribute('data-i18n')!, args(el))));
  root.querySelectorAll('[data-i18n-html]').forEach((el) => (el.innerHTML = tk(el.getAttribute('data-i18n-html')!, args(el))));
  root.querySelectorAll('[data-i18n-title]').forEach((el) => el.setAttribute('title', tk(el.getAttribute('data-i18n-title')!)));
}
