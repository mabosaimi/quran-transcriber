import { beforeEach, describe, expect, it } from 'vitest';
import {
  getEffectiveDirection,
  getEffectiveLanguage,
  getMessage,
  getUiLanguage,
  localizeDOM,
  setUiLanguage,
  type LocalizableRoot,
} from '@/lib/i18n';
import { DEFAULT_LAYER_ORDER, normalizeLayerOrder } from '@/lib/state';

describe('i18n utility', () => {
  beforeEach(() => {
    setUiLanguage('system');
  });

  it('defaults to system language setting', () => {
    expect(getUiLanguage()).toBe('system');
  });

  it('switches to English and returns LTR direction', () => {
    setUiLanguage('en');
    expect(getUiLanguage()).toBe('en');
    expect(getEffectiveLanguage()).toBe('en');
    expect(getEffectiveDirection()).toBe('ltr');
    expect(getMessage('@@bidi_dir')).toBe('ltr');
    expect(getMessage('@@ui_locale')).toBe('en');
  });

  it('switches to Arabic and returns RTL direction', () => {
    setUiLanguage('ar');
    expect(getUiLanguage()).toBe('ar');
    expect(getEffectiveLanguage()).toBe('ar');
    expect(getEffectiveDirection()).toBe('rtl');
    expect(getMessage('@@bidi_dir')).toBe('rtl');
    expect(getMessage('@@ui_locale')).toBe('ar');
  });

  it('retrieves localized messages correctly for both languages', () => {
    setUiLanguage('en');
    expect(getMessage('startCapture')).toBe('Start Listening');

    setUiLanguage('ar');
    expect(getMessage('startCapture')).toBe('بدء الاستماع');
  });

  it('substitutes positional placeholders and handles Arabic verse count grammar (Tamyiz al-Adad)', () => {
    setUiLanguage('en');
    expect(getMessage('versesCount', ['1'])).toBe('1 verse');
    expect(getMessage('versesCount', ['7'])).toBe('7 verses');
    expect(getMessage('versesCount', ['286'])).toBe('286 verses');

    setUiLanguage('ar');
    // 3-10 verses takes plural genitive (آيات)
    expect(getMessage('versesCount', ['3'])).toBe('3 آيات');
    expect(getMessage('versesCount', ['7'])).toBe('7 آيات');
    expect(getMessage('versesCount', ['10'])).toBe('10 آيات');
    // 11+ verses takes singular accusative (آية)
    expect(getMessage('versesCount', ['11'])).toBe('11 آية');
    expect(getMessage('versesCount', ['286'])).toBe('286 آية');
  });

  it('reflects updated professional terminology in Arabic', () => {
    setUiLanguage('ar');
    expect(getMessage('extName')).toBe('متابع التلاوة');
    expect(getMessage('densityCompact')).toBe('مدمج');
    expect(getMessage('fontSizeNormal')).toBe('عادي');
    expect(getMessage('download')).toBe('تنزيل');
    expect(getMessage('downloaded')).toBe('تم التنزيل');
    expect(getMessage('downloading')).toBe('جارٍ التنزيل...');
    expect(getMessage('remove')).toBe('إزالة');
    expect(getMessage('changeSurah')).toBe('اختيار السورة');
    expect(getMessage('transliteration')).toBe('النطق الصوتي (النقحرة)');
  });

  it('localizes DOM elements using mock localizable root', () => {
    const mockElements = {
      button: {
        textContent: '',
        title: '',
        dataset: { i18n: 'startCapture', i18nTitle: 'startCapture' } as unknown as DOMStringMap,
      },
      input: {
        placeholder: '',
        dataset: { i18nPlaceholder: 'searchSurahPlaceholder' } as unknown as DOMStringMap,
      },
      iconBtn: {
        ariaLabel: '',
        setAttribute(attr: string, val: string) {
          if (attr === 'aria-label') this.ariaLabel = val;
        },
        dataset: { i18nAriaLabel: 'settings' } as unknown as DOMStringMap,
      },
    };

    const mockRoot: LocalizableRoot = {
      querySelectorAll(selector: string) {
        if (selector === '[data-i18n]') return [mockElements.button];
        if (selector === '[data-i18n-title]') return [mockElements.button];
        if (selector === '[data-i18n-placeholder]') return [mockElements.input];
        if (selector === '[data-i18n-aria-label]') return [mockElements.iconBtn];
        return [];
      },
    };

    setUiLanguage('ar');
    localizeDOM(mockRoot);

    expect(mockElements.button.textContent).toBe('بدء الاستماع');
    expect(mockElements.button.title).toBe('بدء الاستماع');
    expect(mockElements.input.placeholder).toBe(
      'ابحث باسم السورة، رقمها، أو آية (مثلاً: الكهف، 18، 18:10)...',
    );
    expect(mockElements.iconBtn.ariaLabel).toBe('الإعدادات');
  });

  it('updates document.documentElement dir, lang, and title when localizeDOM is invoked', () => {
    const originalDoc = globalThis.document;
    const mockDoc = {
      title: '',
      documentElement: { dir: '', lang: '' },
      querySelectorAll: () => [],
    };
    // @ts-expect-error Mocking global document for node test runner
    globalThis.document = mockDoc;

    try {
      setUiLanguage('ar');
      localizeDOM();
      expect(mockDoc.documentElement.dir).toBe('rtl');
      expect(mockDoc.documentElement.lang).toBe('ar');
      expect(mockDoc.title).toBe('متابع التلاوة');

      setUiLanguage('en');
      localizeDOM();
      expect(mockDoc.documentElement.dir).toBe('ltr');
      expect(mockDoc.documentElement.lang).toBe('en');
      expect(mockDoc.title).toBe('Quran Transcriber');
    } finally {
      globalThis.document = originalDoc;
    }
  });

  it('normalizes custom verse card layer order and fills missing layers', () => {
    expect(normalizeLayerOrder()).toEqual([...DEFAULT_LAYER_ORDER]);
    expect(normalizeLayerOrder(['translation', 'arabic', 'transliteration', 'tafsir'])).toEqual([
      'translation',
      'arabic',
      'transliteration',
      'tafsir',
    ]);
    expect(normalizeLayerOrder(['translation', 'invalid', 'translation'])).toEqual([
      'translation',
      'arabic',
      'transliteration',
      'tafsir',
    ]);
  });
});
