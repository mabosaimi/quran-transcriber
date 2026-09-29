import { beforeAll, describe, expect, it } from 'vitest';
import {
  type CorpusAyah,
  getCorpusAyah,
  getSurahVerses,
  initCorpus,
  isCorpusLoaded,
  type QuranVerseTuple,
} from '@/lib/quran-corpus';
import { SURAHS } from '@/lib/quran-meta';
import rawQuranCorpus from '@/public/data/quran.json';

describe('Quran Corpus Accessor (lib/quran-corpus)', () => {
  beforeAll(() => {
    initCorpus(rawQuranCorpus as QuranVerseTuple[]);
  });

  it('reports corpusLoaded as true after initialization', () => {
    expect(isCorpusLoaded()).toBe(true);
  });

  it('loads all 6,236 verses across all 114 Surahs', () => {
    let total = 0;
    for (let s = 1; s <= 114; s++) {
      const verses = getSurahVerses(s);
      const expectedMeta = SURAHS[s - 1];
      expect(verses.length).toBe(expectedMeta?.totalAyahs);
      total += verses.length;
    }
    expect(total).toBe(6236);
  });

  it('correctly retrieves Surah Al-Fatihah (Surah 1)', () => {
    const fatihah = getSurahVerses(1);
    expect(fatihah).toHaveLength(7);
    expect(fatihah[0]?.surah).toBe(1);
    expect(fatihah[0]?.ayah).toBe(1);
    expect(fatihah[0]?.uthmani).toBe('بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ');
    expect(fatihah[0]?.surahNameArabic).toBe('الفاتحة');
    expect(fatihah[0]?.surahNameEnglish).toBe('Al-Fatihah');
    expect(fatihah[6]?.ayah).toBe(7);
    expect(fatihah[6]?.index).toBe(6);
  });

  it('correctly retrieves Surah Al-Baqarah (Surah 2)', () => {
    const baqarah = getSurahVerses(2);
    expect(baqarah).toHaveLength(286);
    expect(baqarah[0]?.ayah).toBe(1);
    expect(baqarah[0]?.index).toBe(7); // After 7 verses of Al-Fatihah
    expect(baqarah[254]?.ayah).toBe(255); // Ayat al-Kursi
    expect(baqarah[285]?.ayah).toBe(286);
    expect(baqarah[285]?.index).toBe(292);
  });

  it('correctly retrieves Surah An-Nas (Surah 114)', () => {
    const nas = getSurahVerses(114);
    expect(nas).toHaveLength(6);
    expect(nas[0]?.ayah).toBe(1);
    expect(nas[5]?.ayah).toBe(6);
    expect(nas[5]?.index).toBe(6235); // Last verse of the Quran
  });

  it('returns empty array for invalid Surah numbers', () => {
    expect(getSurahVerses(0)).toEqual([]);
    expect(getSurahVerses(115)).toEqual([]);
    expect(getSurahVerses(-1)).toEqual([]);
  });

  it('returns cached reference on subsequent calls', () => {
    const firstCall = getSurahVerses(36);
    const secondCall = getSurahVerses(36);
    expect(firstCall).toBe(secondCall);
  });

  it('correctly retrieves single ayah by corpus index', () => {
    const first = getCorpusAyah(0);
    expect(first?.surah).toBe(1);
    expect(first?.ayah).toBe(1);

    const last = getCorpusAyah(6235);
    expect(last?.surah).toBe(114);
    expect(last?.ayah).toBe(6);

    expect(getCorpusAyah(-1)).toBeUndefined();
    expect(getCorpusAyah(6236)).toBeUndefined();
  });

  it('identifies Sajdah verses accurately', () => {
    const sajdaSurah = getSurahVerses(32);
    const sajdahAyah = sajdaSurah[14]; // 32:15
    expect(sajdahAyah?.ayah).toBe(15);
    expect(sajdahAyah?.isSajdah).toBe(true);

    const nonSajdahAyah = sajdaSurah[13]; // 32:14
    expect(nonSajdahAyah?.ayah).toBe(14);
    expect(nonSajdahAyah?.isSajdah).toBe(false);
  });
});
