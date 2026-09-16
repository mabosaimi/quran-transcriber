import { beforeEach, describe, expect, it } from 'vitest';
import { QuranMatcher, type QuranVerse } from '@/lib/matcher';

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
