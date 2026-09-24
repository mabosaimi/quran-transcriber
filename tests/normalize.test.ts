import { describe, expect, it } from 'vitest';
import { normalizeArabic } from '@/lib/normalize';

describe('normalizeArabic', () => {
  it('strips Arabic diacritics (tashkeel and superscript alef)', () => {
    const withTashkeel = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ';
    const expected = 'بسم الله الرحمن الرحيم';
    expect(normalizeArabic(withTashkeel)).toBe(expected);
  });

  it('strips tatweel (kashida)', () => {
    const withTatweel = 'كــــتـــاب';
    expect(normalizeArabic(withTatweel)).toBe('كتاب');
  });

  it('normalizes alef variants to bare alef', () => {
    expect(normalizeArabic('أحمد')).toBe('احمد');
    expect(normalizeArabic('إبراهيم')).toBe('ابراهيم');
    expect(normalizeArabic('آمن')).toBe('امن');
    expect(normalizeArabic('ٱلرحمن')).toBe('الرحمن');
  });

  it('normalizes hamza seats and strips standalone hamza', () => {
    expect(normalizeArabic('مؤمن')).toBe('مومن');
    expect(normalizeArabic('بئر')).toBe('بير');
    expect(normalizeArabic('سماء')).toBe('سما');
  });

  it('normalizes alif maqsura and taa marbuta', () => {
    expect(normalizeArabic('هدى')).toBe('هدي');
    expect(normalizeArabic('رحمة')).toBe('رحمه');
  });

  it('removes non-Arabic characters, digits, and punctuation', () => {
    expect(normalizeArabic('الحمد لله! (123)')).toBe('الحمد لله');
  });

  it('collapses repeated whitespace and trims edges', () => {
    expect(normalizeArabic('   قل   هو   الله   احد   ')).toBe('قل هو الله احد');
  });

  it('returns an empty string for non-Arabic input', () => {
    expect(normalizeArabic('Hello World 12345 !@#$')).toBe('');
  });

  it('re-attaches orphaned single-letter proclitics emitted by speech recognition', () => {
    expect(normalizeArabic('و الذين كفروا')).toBe('والذين كفروا');
    expect(normalizeArabic('ف قال لهم')).toBe('فقال لهم');
    expect(normalizeArabic('ب الله')).toBe('بالله');
    expect(normalizeArabic('و ب الحق')).toBe('وبالحق');
    expect(normalizeArabic('و الشمس و ضحاها')).toBe('والشمس وضحاها');
  });
});
