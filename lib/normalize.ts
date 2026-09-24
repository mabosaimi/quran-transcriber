/**
 * Normalizes Arabic text for speech-to-text Quranic verse matching:
 * 1. Strips Tashkeel (harakat, shaddah, superscript alif) and Tatweel (kashida).
 * 2. Collapses orthographic variants (alefs, hamzas, alif maqsura, taa marbuta).
 * 3. Strips non-Arabic characters.
 * 4. Re-attaches single-letter proclitics (و، ف، ب، ل) detached by speech recognition.
 *
 * @param text Raw Arabic transcript from speech recognition or corpus.
 * @returns Normalized text ready for tokenization and indexing.
 */
export function normalizeArabic(text: string): string {
  const cleaned = text
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\u0621-\u064A\s]/g, '');

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) {
    return tokens.join(' ');
  }

  const result: string[] = [];
  let prefix = '';

  for (const t of tokens) {
    if (t === 'و' || t === 'ف' || t === 'ب' || t === 'ل') {
      prefix += t;
    } else {
      result.push(prefix + t);
      prefix = '';
    }
  }

  if (prefix) {
    result.push(prefix);
  }

  return result.join(' ');
}
