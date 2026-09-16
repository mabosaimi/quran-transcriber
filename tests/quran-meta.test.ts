import { describe, expect, it } from 'vitest';
import {
  formatAyahMarker,
  getSurahMeta,
  isSajdah,
  SAJDAH_AYAHS,
  SURAHS,
  toArabicNumerals,
} from '@/lib/quran-meta';

describe('quran-meta', () => {
  describe('SURAHS dataset', () => {
    it('contains exactly 114 Surahs', () => {
      expect(SURAHS.length).toBe(114);
    });

    it('indexes each Surah with sequential 1-based numbering', () => {
      expect(SURAHS[0]?.number).toBe(1);
      expect(SURAHS[113]?.number).toBe(114);
    });
  });

  describe('getSurahMeta', () => {
    it('returns correct metadata for first and last Surahs', () => {
      const fatihah = getSurahMeta(1);
      expect(fatihah).toEqual({
        number: 1,
        nameArabic: 'الفاتحة',
        nameEnglish: 'Al-Fatihah',
        totalAyahs: 7,
      });

      const nas = getSurahMeta(114);
      expect(nas).toEqual({
        number: 114,
        nameArabic: 'الناس',
        nameEnglish: 'An-Nas',
        totalAyahs: 6,
      });
    });

    it('returns undefined for invalid or out-of-range Surah numbers', () => {
      expect(getSurahMeta(0)).toBeUndefined();
      expect(getSurahMeta(115)).toBeUndefined();
      expect(getSurahMeta(-1)).toBeUndefined();
    });
  });

  describe('toArabicNumerals', () => {
    it('converts zero and single-digit integers', () => {
      expect(toArabicNumerals(0)).toBe('٠');
      expect(toArabicNumerals(1)).toBe('١');
      expect(toArabicNumerals(5)).toBe('٥');
      expect(toArabicNumerals(9)).toBe('٩');
    });

    it('converts multi-digit integers correctly', () => {
      expect(toArabicNumerals(10)).toBe('١٠');
      expect(toArabicNumerals(42)).toBe('٤٢');
      expect(toArabicNumerals(286)).toBe('٢٨٦');
    });

    it('handles non-integer decimal numbers', () => {
      expect(toArabicNumerals(3.14)).toBe('٣.١٤');
    });
  });

  describe('formatAyahMarker', () => {
    it('encloses numerals within ornate Quranic brackets', () => {
      expect(formatAyahMarker(1)).toBe('\uFD3F١\uFD3E');
      expect(formatAyahMarker(7)).toBe('\uFD3F٧\uFD3E');
      expect(formatAyahMarker(286)).toBe('\uFD3F٢٨٦\uFD3E');
    });

    it('preserves logical order with opening bracket first', () => {
      const marker = formatAyahMarker(5);
      expect(marker.charCodeAt(0)).toBe(0xfd3f);
      expect(marker.charCodeAt(marker.length - 1)).toBe(0xfd3e);
    });
  });

  describe('isSajdah & SAJDAH_AYAHS', () => {
    it('contains exactly 15 canonical Sajdah ayahs', () => {
      expect(SAJDAH_AYAHS.size).toBe(15);
    });

    it('identifies canonical Sajdah verses correctly', () => {
      expect(isSajdah(7, 206)).toBe(true);
      expect(isSajdah(13, 15)).toBe(true);
      expect(isSajdah(22, 18)).toBe(true);
      expect(isSajdah(22, 77)).toBe(true);
      expect(isSajdah(32, 15)).toBe(true);
      expect(isSajdah(96, 19)).toBe(true);
    });

    it('returns false for non-Sajdah verses', () => {
      expect(isSajdah(1, 1)).toBe(false);
      expect(isSajdah(2, 255)).toBe(false);
      expect(isSajdah(114, 6)).toBe(false);
    });
  });
});
