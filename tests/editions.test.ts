import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURATED_EDITIONS,
  deleteCachedEdition,
  EditionValidationError,
  fetchAndCacheEdition,
  getCachedEdition,
  getCachedEditionIds,
  getLanguageEndonym,
  loadActiveEditions,
  validateAndFlattenEdition,
} from '@/lib/editions';
import { SURAHS } from '@/lib/quran-meta';

function buildMockValidPayload(identifier = 'en.mock', direction = 'ltr') {
  const surahs = SURAHS.map((meta) => {
    const ayahs = Array.from({ length: meta.totalAyahs }, (_, i) => ({
      number: i + 1,
      text: `Translation of Surah ${meta.number} Ayah ${i + 1}`,
      numberInSurah: i + 1,
    }));
    return {
      number: meta.number,
      name: meta.nameArabic,
      ayahs,
    };
  });

  return {
    code: 200,
    status: 'OK',
    data: {
      edition: {
        identifier,
        name: 'Mock Edition',
        englishName: 'Mock Edition English',
        language: 'en',
        type: 'translation',
        direction,
      },
      surahs,
    },
  };
}

describe('lib/editions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('CURATED_EDITIONS', () => {
    it('contains baseline English translation and transliteration', () => {
      const ids = CURATED_EDITIONS.map((e) => e.identifier);
      expect(ids).toContain('en.sahih');
      expect(ids).toContain('en.transliteration');
    });

    it('assigns correct directionality to RTL and LTR languages', () => {
      const urdu = CURATED_EDITIONS.find((e) => e.identifier === 'ur.jalandhry');
      expect(urdu?.direction).toBe('rtl');

      const english = CURATED_EDITIONS.find((e) => e.identifier === 'en.sahih');
      expect(english?.direction).toBe('ltr');
    });

    it('provides native endonyms for all curated languages', () => {
      const french = CURATED_EDITIONS.find((e) => e.identifier === 'fr.hamidullah');
      expect(french?.nativeName).toBe('Français');

      const urdu = CURATED_EDITIONS.find((e) => e.identifier === 'ur.jalandhry');
      expect(urdu?.nativeName).toBe('اردو');

      const turkish = CURATED_EDITIONS.find((e) => e.identifier === 'tr.diyanet');
      expect(turkish?.nativeName).toBe('Türkçe');
    });
  });

  describe('getLanguageEndonym', () => {
    it('returns native language names for supported codes', () => {
      expect(getLanguageEndonym('ar')).toBe('العربية');
      expect(getLanguageEndonym('fr')).toBe('Français');
      expect(getLanguageEndonym('ur')).toBe('اردو');
      expect(getLanguageEndonym('id')).toBe('Bahasa Indonesia');
      expect(getLanguageEndonym('ru')).toBe('Русский');
    });

    it('falls back to uppercase code for unknown languages', () => {
      expect(getLanguageEndonym('zh')).toBe('ZH');
    });
  });

  describe('validateAndFlattenEdition', () => {
    it('successfully validates and flattens a valid 6,236-ayah payload', () => {
      const payload = buildMockValidPayload('en.test', 'ltr');
      const edition = validateAndFlattenEdition(payload);

      expect(edition.identifier).toBe('en.test');
      expect(edition.direction).toBe('ltr');
      expect(edition.type).toBe('translation');
      expect(edition.ayahs.length).toBe(6236);
      expect(edition.ayahs[0]).toBe('Translation of Surah 1 Ayah 1');
      expect(edition.ayahs[6235]).toBe('Translation of Surah 114 Ayah 6');
    });

    it('throws EditionValidationError when payload is null or not an object', () => {
      expect(() => validateAndFlattenEdition(null)).toThrow(EditionValidationError);
      expect(() => validateAndFlattenEdition('string')).toThrow(EditionValidationError);
    });

    it('throws EditionValidationError when status is not OK or code is not 200', () => {
      expect(() =>
        validateAndFlattenEdition({ code: 404, status: 'Not Found', data: {} }),
      ).toThrow(EditionValidationError);
    });

    it('throws EditionValidationError when surahs array length is not 114', () => {
      const payload = buildMockValidPayload();
      payload.data.surahs = payload.data.surahs.slice(0, 100);
      expect(() => validateAndFlattenEdition(payload)).toThrow(
        /Surah count mismatch: expected 114/,
      );
    });

    it('throws EditionValidationError when ayah count for a Surah is incorrect', () => {
      const payload = buildMockValidPayload();
      // Al-Fatihah (Surah 1) must have 7 ayahs; set it to 6
      payload.data.surahs[0]!.ayahs = payload.data.surahs[0]!.ayahs.slice(0, 6);
      expect(() => validateAndFlattenEdition(payload)).toThrow(
        /Surah 1 \(Al-Fatihah\) ayah count mismatch: expected 7, received 6/,
      );
    });

    it('throws EditionValidationError when an ayah text is missing or not a string', () => {
      const payload = buildMockValidPayload();
      // @ts-expect-error invalid test payload
      payload.data.surahs[0]!.ayahs[0] = { number: 1, text: null };
      expect(() => validateAndFlattenEdition(payload)).toThrow(
        /text is missing or not a string/,
      );
    });

    it('throws EditionValidationError when edition metadata is missing', () => {
      const payload = buildMockValidPayload();
      // @ts-expect-error invalid test payload
      payload.data.edition = null;
      expect(() => validateAndFlattenEdition(payload)).toThrow(
        /Missing or invalid edition metadata/,
      );
    });
  });

  describe('fetchAndCacheEdition', () => {
    it('returns cached edition if already stored', async () => {
      const validPayload = buildMockValidPayload('en.cached');
      const expected = validateAndFlattenEdition(validPayload);

      // Pre-cache
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;

      const { set } = await import('idb-keyval');
      await set('edition:en.cached', expected);

      const result = await fetchAndCacheEdition('en.cached');
      expect(result).toEqual(expected);
      expect(mockFetch).not.toHaveBeenCalled();

      await deleteCachedEdition('en.cached');
    });

    it('fetches, validates, and stores edition on cache miss', async () => {
      const validPayload = buildMockValidPayload('en.remote');
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => validPayload,
      });

      const result = await fetchAndCacheEdition('en.remote');
      expect(result.identifier).toBe('en.remote');
      expect(result.ayahs.length).toBe(6236);

      const inCache = await getCachedEdition('en.remote');
      expect(inCache).toBeDefined();
      expect(inCache?.identifier).toBe('en.remote');

      await deleteCachedEdition('en.remote');
    });
  });

  describe('getCachedEditionIds', () => {
    it('returns empty array when no editions are cached', async () => {
      const ids = await getCachedEditionIds();
      expect(Array.isArray(ids)).toBe(true);
    });

    it('returns identifiers for cached editions', async () => {
      const mock = validateAndFlattenEdition(buildMockValidPayload('en.id-test'));
      const { set } = await import('idb-keyval');
      await set('edition:en.id-test', mock);

      const ids = await getCachedEditionIds();
      expect(ids).toContain('en.id-test');

      await deleteCachedEdition('en.id-test');
      const afterIds = await getCachedEditionIds();
      expect(afterIds).not.toContain('en.id-test');
    });
  });

  describe('loadActiveEditions', () => {
    it('loads requested transliteration and translations into a map', async () => {
      const translitEdition = validateAndFlattenEdition(buildMockValidPayload('en.translit-test'));
      translitEdition.type = 'transliteration';
      const translationEdition = validateAndFlattenEdition(buildMockValidPayload('en.trans-test'));

      const { set } = await import('idb-keyval');
      await set('edition:en.translit-test', translitEdition);
      await set('edition:en.trans-test', translationEdition);

      const map = await loadActiveEditions({
        activeTranslationId: 'en.trans-test',
        showTransliteration: true,
        activeTransliterationId: 'en.translit-test',
        activeTranslationIds: ['en.trans-test'],
      });

      expect(map.size).toBe(2);
      expect(map.has('en.translit-test')).toBe(true);
      expect(map.has('en.trans-test')).toBe(true);

      await deleteCachedEdition('en.translit-test');
      await deleteCachedEdition('en.trans-test');
    });

    it('loads nothing when Arabic Only is selected and transliteration is disabled', async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;

      const map = await loadActiveEditions({
        activeTranslationId: null,
        showTransliteration: false,
        activeTransliterationId: 'en.transliteration',
        activeTranslationIds: [],
      });

      expect(map.size).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
