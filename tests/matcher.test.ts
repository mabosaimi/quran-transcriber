import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QuranMatcher, type QuranVerse } from '@/lib/matcher';
import quranCorpusRaw from '@/public/data/quran.json';

const SAMPLE_CORPUS: QuranVerse[] = [
  [1, 1, 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', 'بسم الله الرحمن الرحيم'],
  [1, 2, 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ', 'الحمد لله رب العالمين'],
  [1, 3, 'ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', 'الرحمن الرحيم'],
  [1, 4, 'مَٰلِكِ يَوْمِ ٱلدِّينِ', 'مالك يوم الدين'],
];

describe('QuranMatcher', () => {
  let matcher: QuranMatcher;

  beforeEach(() => {
    matcher = new QuranMatcher(SAMPLE_CORPUS);
  });

  it('returns null for empty or non-Arabic transcripts', () => {
    expect(matcher.match('')).toBeNull();
    expect(matcher.match('   ')).toBeNull();
    expect(matcher.match('Hello world testing 123')).toBeNull();
  });

  it('matches a verse from exact normalized input', () => {
    const result = matcher.match('الحمد لله رب العالمين');
    expect(result).not.toBeNull();
    expect(result?.surah).toBe(1);
    expect(result?.ayah).toBe(2);
    expect(result?.index).toBe(1);
    expect(result?.isSequential).toBe(false);
  });

  it('matches input containing unnormalized diacritics and hamzas', () => {
    const result = matcher.match('بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ');
    expect(result).not.toBeNull();
    expect(result?.surah).toBe(1);
    expect(result?.ayah).toBe(1);
  });

  it('flags sequential progression when moving from one verse to the next', () => {
    const firstMatch = matcher.match('بسم الله الرحمن الرحيم');
    expect(firstMatch?.ayah).toBe(1);
    expect(firstMatch?.isSequential).toBe(false);

    const secondMatch = matcher.match('الحمد لله رب العالمين');
    expect(secondMatch?.ayah).toBe(2);
    expect(secondMatch?.isSequential).toBe(true);
    // Score includes token matches (4) + sequential progression bonus (2.5)
    expect(secondMatch?.score).toBeGreaterThanOrEqual(6.5);
  });

  it('flags sequential repeat when continuing speech within the same verse', () => {
    matcher.match('الحمد لله');
    const sameVerseMatch = matcher.match('الحمد لله رب العالمين');
    expect(sameVerseMatch?.ayah).toBe(2);
    expect(sameVerseMatch?.isSequential).toBe(true);
  });

  it('rejects matches when matching tokens fall below acceptance ratio threshold', () => {
    // Only one matched word ("الله") out of 5 words (1/5 = 20% < 45% threshold)
    const result = matcher.match('كتاب الله كبير واسع جدا');
    expect(result).toBeNull();
  });

  it('evaluates only the trailing sliding window of up to 8 tokens', () => {
    // 9 tokens: first word ("فاطر") should be discarded outside the 8-word window
    const transcript = 'فاطر بسم الله الرحمن الرحيم تماما ماشي نعم';
    const result = matcher.match(transcript);
    expect(result?.ayah).toBe(1);
  });

  it('resets tracking state when reset() is called', () => {
    matcher.match('بسم الله الرحمن الرحيم');
    matcher.reset();

    // After reset, matching the next verse should not be marked sequential
    const nextMatch = matcher.match('الحمد لله رب العالمين');
    expect(nextMatch?.ayah).toBe(2);
    expect(nextMatch?.isSequential).toBe(false);
  });
});

describe('QuranMatcher Production Corpus Integration', () => {
  const productionCorpus = quranCorpusRaw as unknown as QuranVerse[];
  let productionMatcher: QuranMatcher;

  beforeAll(() => {
    productionMatcher = new QuranMatcher(productionCorpus);
  });

  beforeEach(() => {
    productionMatcher.reset();
  });

  it('indexes all 6,236 verses from the production dataset', () => {
    expect(productionCorpus).toHaveLength(6236);
  });

  it('accurately resolves verses across diverse Surahs', () => {
    const alFatihah = productionMatcher.match('الحمد لله رب العالمين');
    expect(alFatihah?.surah).toBe(1);
    expect(alFatihah?.ayah).toBe(2);

    productionMatcher.reset();
    const ayatAlKursi = productionMatcher.match('الله لا اله الا هو الحي القيوم');
    expect(ayatAlKursi?.surah).toBe(2);
    expect(ayatAlKursi?.ayah).toBe(255);

    productionMatcher.reset();
    const alIkhlas = productionMatcher.match('قل هو الله احد الله الصمد');
    expect(alIkhlas?.surah).toBe(112);
    expect(alIkhlas?.ayah).toBe(1);
  });

  it('executes in-memory matching within sub-millisecond latency budget', () => {
    const testQueries = [
      'الحمد لله رب العالمين',
      'قل هو الله احد',
      'الله لا اله الا هو الحي القيوم',
      'والضحى والليل اذا سجى',
      'تبارك الذي بيده الملك',
      'انا اعطيناك الكوثر',
    ];

    // Warm up JIT optimizer
    for (const query of testQueries) {
      productionMatcher.match(query);
    }

    const iterations = 500;
    const startTime = performance.now();
    for (let i = 0; i < iterations; i++) {
      const query = testQueries[i % testQueries.length];
      if (query) {
        productionMatcher.match(query);
      }
    }
    const elapsedMs = performance.now() - startTime;
    const avgLatencyMs = elapsedMs / iterations;

    // Sub-millisecond budget: average match must complete in < 1.0 ms
    expect(avgLatencyMs).toBeLessThan(1.0);
  });
});
