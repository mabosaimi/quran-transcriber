import arMessages from '../public/_locales/ar/messages.json';
import enMessages from '../public/_locales/en/messages.json';

export type UiLanguage = 'system' | 'en' | 'ar';
export type EffectiveLanguage = 'en' | 'ar';
export type TextDirection = 'ltr' | 'rtl';

interface PlaceholderDef {
  content: string;
  example?: string;
}

interface MessageEntry {
  message: string;
  description?: string;
  placeholders?: Record<string, PlaceholderDef>;
}

type LocaleBundle = Record<string, MessageEntry>;

const bundles: Record<EffectiveLanguage, LocaleBundle> = {
  en: enMessages as unknown as LocaleBundle,
  ar: arMessages as unknown as LocaleBundle,
};

let currentLanguage: UiLanguage = 'system';

/**
 * Determine the system/browser language, falling back to 'en'.
 */
function detectSystemLanguage(): EffectiveLanguage {
  try {
    const browserLang =
      (typeof browser !== 'undefined' && browser.i18n?.getUILanguage?.()) ||
      (typeof navigator !== 'undefined' && (navigator.language || navigator.languages?.[0])) ||
      'en';

    return browserLang.toLowerCase().startsWith('ar') ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Sets the active UI language setting.
 */
export function setUiLanguage(lang: UiLanguage): void {
  currentLanguage = lang;
}

/**
 * Returns the currently configured UI language setting ('system', 'en', or 'ar').
 */
export function getUiLanguage(): UiLanguage {
  return currentLanguage;
}

/**
 * Resolves the effective language ('en' or 'ar') accounting for 'system' detection.
 */
export function getEffectiveLanguage(): EffectiveLanguage {
  if (currentLanguage === 'ar' || currentLanguage === 'en') {
    return currentLanguage;
  }
  return detectSystemLanguage();
}

/**
 * Returns text direction ('ltr' or 'rtl') based on effective language.
 */
export function getEffectiveDirection(): TextDirection {
  return getEffectiveLanguage() === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Formats a message template by substituting declared placeholders and positional tokens ($1, $2, etc.).
 */
function formatMessage(entry: MessageEntry, substitutions?: string | string[]): string {
  let template = entry.message;
  if (!substitutions) return template;
  const subs = Array.isArray(substitutions) ? substitutions : [substitutions];

  // 1. Substitute declared placeholders ($NAME$) using their mapping content (e.g. $1)
  if (entry.placeholders) {
    for (const [placeholderName, def] of Object.entries(entry.placeholders)) {
      let value = def.content;
      for (let i = 0; i < subs.length; i++) {
        value = value.replaceAll(`$${i + 1}`, subs[i] ?? '');
      }
      const tokenRegex = new RegExp(`\\$${placeholderName}\\$`, 'gi');
      template = template.replace(tokenRegex, value);
    }
  }

  // 2. Substitute direct positional tokens $1, $2, etc.
  for (let i = 0; i < subs.length; i++) {
    template = template.replaceAll(`$${i + 1}`, subs[i] ?? '');
  }

  return template;
}

/**
 * Type-safe message lookup supporting dynamic locale switching.
 * Handles standard WebExtension pre-defined keys (@@bidi_dir, @@ui_locale, @@bidi_reversed_dir)
 * and falls back gracefully from active locale -> en -> raw key.
 */
export function getMessage(key: string, substitutions?: string | string[]): string {
  if (key === '@@bidi_dir') {
    return getEffectiveDirection();
  }
  if (key === '@@ui_locale') {
    return getEffectiveLanguage();
  }
  if (key === '@@bidi_reversed_dir') {
    return getEffectiveDirection() === 'rtl' ? 'ltr' : 'rtl';
  }
  if (key === '@@bidi_start_edge') {
    return getEffectiveDirection() === 'rtl' ? 'right' : 'left';
  }
  if (key === '@@bidi_end_edge') {
    return getEffectiveDirection() === 'rtl' ? 'left' : 'right';
  }

  const effectiveLang = getEffectiveLanguage();

  // Grammatically correct Arabic verse count rule (Tamyiz al-'Adad):
  // 3-10: آيات (e.g. 7 آيات)
  // 11+: آية (e.g. 286 آية)
  if (key === 'versesCount') {
    const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
    const rawCount = subs[0];
    if (rawCount !== undefined && rawCount !== null) {
      const count = Number(rawCount);
      if (!Number.isNaN(count)) {
        if (effectiveLang === 'ar') {
          if (count >= 3 && count <= 10) {
            return `${count} آيات`;
          }
          return `${count} آية`;
        }
        return count === 1 ? '1 verse' : `${count} verses`;
      }
    }
  }

  const bundle = bundles[effectiveLang];
  const entry = bundle?.[key];

  if (entry?.message) {
    return formatMessage(entry, substitutions);
  }

  // Fallback to English bundle if not found in active locale
  const fallbackEntry = bundles.en?.[key];
  if (fallbackEntry?.message) {
    return formatMessage(fallbackEntry, substitutions);
  }

  // Fallback to native browser.i18n if available
  try {
    if (typeof browser !== 'undefined' && browser.i18n?.getMessage) {
      const nativeMsg = browser.i18n.getMessage(
        key as Parameters<typeof browser.i18n.getMessage>[0],
        substitutions as string[],
      );
      if (nativeMsg) return nativeMsg;
    }
  } catch {}

  return key;
}

export interface LocalizableElement {
  textContent?: string | null;
  title?: string;
  placeholder?: string;
  dataset: DOMStringMap;
  setAttribute?: (name: string, value: string) => void;
}

export interface LocalizableRoot {
  querySelectorAll(selector: string): Iterable<LocalizableElement>;
}

/**
 * Automatically walks and localizes DOM elements marked with data-i18n attributes.
 */
export function localizeDOM(root?: LocalizableRoot): void {
  const dir = getEffectiveDirection();
  const lang = getEffectiveLanguage();

  if (typeof document !== 'undefined') {
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
    document.title = getMessage('extName');
  }

  const targetRoot =
    root ?? (typeof document !== 'undefined' ? (document as unknown as LocalizableRoot) : null);
  if (!targetRoot) return;

  const i18nElements = targetRoot.querySelectorAll('[data-i18n]');
  for (const el of i18nElements) {
    const key = el.dataset.i18n;
    if (key) {
      el.textContent = getMessage(key);
    }
  }

  const titleElements = targetRoot.querySelectorAll('[data-i18n-title]');
  for (const el of titleElements) {
    const key = el.dataset.i18nTitle;
    if (key) {
      el.title = getMessage(key);
    }
  }

  const placeholderElements = targetRoot.querySelectorAll('[data-i18n-placeholder]');
  for (const el of placeholderElements) {
    const key = el.dataset.i18nPlaceholder;
    if (key) {
      el.placeholder = getMessage(key);
    }
  }

  const ariaLabelElements = targetRoot.querySelectorAll('[data-i18n-aria-label]');
  for (const el of ariaLabelElements) {
    const key = el.dataset.i18nAriaLabel;
    if (key && typeof el.setAttribute === 'function') {
      el.setAttribute('aria-label', getMessage(key));
    }
  }
}
