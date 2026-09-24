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
    expect(secondMatch?.score).toBeGreaterThan(0);
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

  it('evaluates only the trailing sliding window of up to 10 tokens', () => {
    // 11 tokens: first word ("فاطر") should be discarded outside the 10-word window
    const transcript = 'فاطر بسم الله الرحمن الرحيم تماما ماشي نعم طيب حاضر';
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

  it('discovers single-word hapax and high-IDF verses on cold start', () => {
    // 89:1 والفجر (df=1, IDF=8.74)
    const alFajr = productionMatcher.match('والفجر');
    expect(alFajr?.surah).toBe(89);
    expect(alFajr?.ayah).toBe(1);

    productionMatcher.reset();
    // 103:1 والعصر (df=1, IDF=8.74)
    const alAsr = productionMatcher.match('والعصر');
    expect(alAsr?.surah).toBe(103);
    expect(alAsr?.ayah).toBe(1);

    productionMatcher.reset();
    // 93:1 والضحى (df=1, IDF=8.74)
    const adDuha = productionMatcher.match('والضحى');
    expect(adDuha?.surah).toBe(93);
    expect(adDuha?.ayah).toBe(1);
  });

  it('strictly rejects solitary common words on cold start', () => {
    expect(productionMatcher.match('الله')).toBeNull();
    productionMatcher.reset();
    expect(productionMatcher.match('من')).toBeNull();
    productionMatcher.reset();
    expect(productionMatcher.match('في')).toBeNull();
    productionMatcher.reset();
    expect(productionMatcher.match('قال')).toBeNull();
  });

  it('smoothly transitions across adjacent verses sharing identical vocabulary (Al-Fatihah 1:1 -> 1:4)', () => {
    // 1:1 Bismillah
    const m1 = productionMatcher.match('بسم الله الرحمن الرحيم');
    expect(m1?.surah).toBe(1);
    expect(m1?.ayah).toBe(1);

    // 1:2 Alhamdu lillah
    const m2 = productionMatcher.match('الحمد لله رب العالمين');
    expect(m2?.surah).toBe(1);
    expect(m2?.ayah).toBe(2);
    expect(m2?.isSequential).toBe(true);

    // 1:3 Ar-Rahman ar-Rahim (shares exact words with 1:1 tail)
    const m3 = productionMatcher.match('الحمد لله رب العالمين الرحمن الرحيم');
    expect(m3?.surah).toBe(1);
    expect(m3?.ayah).toBe(3);
    expect(m3?.isSequential).toBe(true);

    // 1:4 Maliki yawmi-d-deen
    const m4 = productionMatcher.match('الرحمن الرحيم مالك يوم الدين');
    expect(m4?.surah).toBe(1);
    expect(m4?.ayah).toBe(4);
    expect(m4?.isSequential).toBe(true);
  });

  it('matches verses when speech recognition emits detached single-letter proclitics', () => {
    const result = productionMatcher.match('و الذين كفروا و كذبوا باياتنا');
    expect(result).not.toBeNull();
    expect(result?.surah).toBe(2);
    expect(result?.ayah).toBe(39);
  });

  it('resolves sequential refrains in Surah Ar-Rahman accurately', () => {
    // Recite opening of Ar-Rahman up to first refrain (55:13)
    const r1 = productionMatcher.match('فباي الا ربكما تكذبان');
    expect(r1?.surah).toBe(55);
    expect(r1?.ayah).toBe(13);

    // Continue to 55:14
    const r2 = productionMatcher.match('خلق الانسان من صلصال كالفخار');
    expect(r2?.surah).toBe(55);
    expect(r2?.ayah).toBe(14);
    expect(r2?.isSequential).toBe(true);

    // Continue to 55:15
    const r3 = productionMatcher.match('وخلق الجان من مارج من نار');
    expect(r3?.surah).toBe(55);
    expect(r3?.ayah).toBe(15);
    expect(r3?.isSequential).toBe(true);

    // Second refrain (55:16)
    const r4 = productionMatcher.match('فباي الا ربكما تكذبان');
    expect(r4?.surah).toBe(55);
    expect(r4?.ayah).toBe(16);
    expect(r4?.isSequential).toBe(true);
  });

  it('supports reciter verse repetition stepping back to previous verse', () => {
    // Start at 1:1
    productionMatcher.match('بسم الله الرحمن الرحيم');
    // Advance to 1:2
    const m2 = productionMatcher.match('الحمد لله رب العالمين');
    expect(m2?.ayah).toBe(2);

    // Reciter repeats 1:1
    const mRepeat = productionMatcher.match('بسم الله الرحمن الرحيم');
    expect(mRepeat?.ayah).toBe(1);
    expect(mRepeat?.isSequential).toBe(true);
  });

  it('maintains passive retention across breath pauses without desyncing prematurely', () => {
    // Lock onto 1:2
    productionMatcher.match('الحمد لله رب العالمين');

    // Simulate 10 interim breath pauses / acoustic noise (which return null during pause)
    for (let i = 0; i < 10; i++) {
      productionMatcher.match('اممم');
    }

    // Next verse arrives: should still transition sequentially to 1:3!
    const nextMatch = productionMatcher.match('الرحمن الرحيم');
    expect(nextMatch?.surah).toBe(1);
    expect(nextMatch?.ayah).toBe(3);
    expect(nextMatch?.isSequential).toBe(true);
  });

  it('prevents flip-flopping between newly matched verse and previous verse during live streaming transitions', () => {
    // 1. Advance to 112:2 (الله الصمد)
    productionMatcher.match('قل هو الله احد');
    const m2 = productionMatcher.match('قل هو الله احد الله الصمد');
    expect(m2?.surah).toBe(112);
    expect(m2?.ayah).toBe(2);

    // 2. Reciter speaks first word of 112:3 (لم يلد ولم يولد)
    const m3_tick1 = productionMatcher.match('الله الصمد لم');
    expect(m3_tick1?.ayah).toBe(3);

    // 3. Immediately next interim tick arrives with identical words (must NOT flip-flop to ayah 2!)
    const m3_tick2 = productionMatcher.match('الله الصمد لم');
    expect(m3_tick2?.ayah).toBe(3);

    // 4. Second word arrives
    const m3_tick3 = productionMatcher.match('الله الصمد لم يلد');
    expect(m3_tick3?.ayah).toBe(3);
  });

  it('prevents flip-flopping between 1:1 and 1:2 across rapid interim speech updates', () => {
    // 1. Reciter locks onto 1:1
    const m1 = productionMatcher.match('بسم الله الرحمن الرحيم');
    expect(m1?.ayah).toBe(1);

    // 2. Reciter speaks end of 1:1 + first word of 1:2: "الحمد"
    const m2_t1 = productionMatcher.match('الله الرحمن الرحيم الحمد');
    expect(m2_t1?.ayah).toBe(2);

    // 3. Immediately next interim tick arrives with identical words (must NOT flip-flop to ayah 1!)
    const m2_t2 = productionMatcher.match('الله الرحمن الرحيم الحمد');
    expect(m2_t2?.ayah).toBe(2);

    // 4. Next interim tick with second word
    const m2_t3 = productionMatcher.match('الرحمن الرحيم الحمد لله');
    expect(m2_t3?.ayah).toBe(2);
  });

  it('transitions sequentially across long verses without getting trapped (2:255 into 2:256)', () => {
    // 1. Reciter locks onto 2:255 (Ayat al-Kursi, 50 words)
    const m255 = productionMatcher.match('الله لا اله الا هو الحي القيوم');
    expect(m255?.surah).toBe(2);
    expect(m255?.ayah).toBe(255);

    // 2. Reciter approaches the end of 2:255
    productionMatcher.match('وسع كرسيه السماوات والارض ولا ييوده حفظهما وهو العلي العظيم');

    // 3. Reciter crosses the boundary into 2:256 (24 words): "العلي العظيم لا اكراه في الدين"
    const m256_head = productionMatcher.match('العلي العظيم لا اكراه في الدين');
    expect(m256_head?.surah).toBe(2);
    expect(m256_head?.ayah).toBe(256);
    expect(m256_head?.isSequential).toBe(true);

    // 4. Reciter continues into 2:256: "لا اكراه في الدين قد تبين الرشد من الغي"
    const m256_body = productionMatcher.match('لا اكراه في الدين قد تبين الرشد من الغي');
    expect(m256_body?.surah).toBe(2);
    expect(m256_body?.ayah).toBe(256);
    expect(m256_body?.isSequential).toBe(true);
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

  it('recovers via discovery fallback when reciter jumps to a distant verse', () => {
    productionMatcher.match('الله لا اله الا هو الحي القيوم');
    const m1 = productionMatcher.match('بسم الله الرحمن الرحيم');
    expect(m1).not.toBeNull();
    expect(m1?.surah).toBe(1);
    expect(m1?.ayah).toBe(1);
  });

  it('recovers via discovery fallback when reciter jumps backward more than one verse', () => {
    productionMatcher.match('بسم الله الرحمن الرحيم');
    productionMatcher.match('الحمد لله رب العالمين');
    productionMatcher.match('الرحمن الرحيم');
    productionMatcher.match('مالك يوم الدين');
    const mBack = productionMatcher.match('الحمد لله رب العالمين');
    expect(mBack).not.toBeNull();
    expect(mBack?.surah).toBe(1);
    expect(mBack?.ayah).toBe(2);
  });

  it('supports backward repetition between adjacent verses that share common words (112:2 to 112:1)', () => {
    productionMatcher.match('قل هو الله احد');
    productionMatcher.match('الله الصمد');
    const repeat = productionMatcher.match('قل هو الله احد');
    expect(repeat).not.toBeNull();
    expect(repeat?.surah).toBe(112);
    expect(repeat?.ayah).toBe(1);
  });

  it('correctly transitions after Basmalah when starting a new Surah (e.g. Al-Ikhlas 112:1)', () => {
    const m0 = productionMatcher.match('بسم الله الرحمن الرحيم');
    expect(m0?.surah).toBe(1);
    expect(m0?.ayah).toBe(1);

    const m1 = productionMatcher.match('بسم الله الرحمن الرحيم قل هو الله احد');
    expect(m1?.surah).toBe(112);
    expect(m1?.ayah).toBe(1);
  });

  it('correctly transitions into Al-Mulk 67:1 after Basmalah', () => {
    productionMatcher.match('بسم الله الرحمن الرحيم');
    const m1 = productionMatcher.match('بسم الله الرحمن الرحيم تبارك الذي بيده الملك');
    expect(m1?.surah).toBe(67);
    expect(m1?.ayah).toBe(1);
  });

  it('still smoothly transitions sequentially from 1:1 into Al-Fatihah 1:2', () => {
    const m0 = productionMatcher.match('بسم الله الرحمن الرحيم');
    expect(m0?.ayah).toBe(1);

    const m1 = productionMatcher.match('بسم الله الرحمن الرحيم الحمد لله رب العالمين');
    expect(m1?.surah).toBe(1);
    expect(m1?.ayah).toBe(2);
    expect(m1?.isSequential).toBe(true);
  });
});

