import { formatAyahMarker, getSurahMeta, isSajdah } from './quran-meta';

export type QuranVerseTuple = [surah: number, ayah: number, uthmani: string, clean: string];

/**
 * Enriched canonical verse object ready for synchronous rendering.
 */
export interface CorpusAyah {
  readonly index: number;
  readonly surah: number;
  readonly ayah: number;
  readonly uthmani: string;
  readonly clean: string;
  readonly totalAyahs: number;
  readonly surahNameArabic: string;
  readonly surahNameEnglish: string;
  readonly ayahMarker: string;
  readonly isSajdah: boolean;
}

let corpusLoaded = false;
let corpusAyahsCache: CorpusAyah[] = [];
const surahStartIndices = new Uint16Array(115);
const surahVersesCache: (readonly CorpusAyah[])[] = new Array(115);

/**
 * Initializes the in-memory verse corpus from raw verse tuples.
 * Idempotent: Subsequent calls are no-ops.
 */
export function initCorpus(corpus: readonly QuranVerseTuple[]): void {
  if (corpusLoaded) return;

  corpusAyahsCache = new Array(corpus.length);

  for (let i = 0; i < corpus.length; i++) {
    const [surah, ayah, uthmani, clean] = corpus[i] as QuranVerseTuple;
    if (ayah === 1 && surah >= 1 && surah <= 114) {
      surahStartIndices[surah] = i;
    }

    const meta = getSurahMeta(surah);
    corpusAyahsCache[i] = Object.freeze({
      index: i,
      surah,
      ayah,
      uthmani,
      clean,
      totalAyahs: meta?.totalAyahs ?? 0,
      surahNameArabic: meta?.nameArabic ?? '',
      surahNameEnglish: meta?.nameEnglish ?? '',
      ayahMarker: formatAyahMarker(ayah),
      isSajdah: isSajdah(surah, ayah),
    });
  }

  corpusLoaded = true;
}

/**
 * Returns whether the corpus has been initialized into memory.
 */
export function isCorpusLoaded(): boolean {
  return corpusLoaded;
}

/**
 * Returns the enriched verse by its 0-based corpus index (0 to 6235).
 */
export function getCorpusAyah(index: number): CorpusAyah | undefined {
  return corpusAyahsCache[index];
}

/**
 * Returns all verses for a given Surah in O(1) time.
 * @param surahNumber 1-based Surah number (1 to 114).
 */
export function getSurahVerses(surahNumber: number): readonly CorpusAyah[] {
  if (surahNumber < 1 || surahNumber > 114 || !corpusLoaded) {
    return [];
  }

  const cached = surahVersesCache[surahNumber];
  if (cached) {
    return cached;
  }

  const meta = getSurahMeta(surahNumber);
  if (!meta) return [];

  const startIndex = surahStartIndices[surahNumber] as number;
  const count = meta.totalAyahs;
  const verses: CorpusAyah[] = new Array(count);

  for (let i = 0; i < count; i++) {
    verses[i] = corpusAyahsCache[startIndex + i] as CorpusAyah;
  }

  const frozen = Object.freeze(verses);
  surahVersesCache[surahNumber] = frozen;
  return frozen;
}
