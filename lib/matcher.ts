import { normalizeArabic } from './normalize';

export type QuranVerse = [number, number, string, string];

export interface MatchResult {
  index: number;
  surah: number;
  ayah: number;
  uthmani: string;
  clean: string;
  score: number;
  isSequential: boolean;
}

export class QuranMatcher {
  private corpus: QuranVerse[];
  private invertedIndex: Map<string, number[]> = new Map();
  private lastMatchedIndex: number | null = null;
  private lastMatchTime = 0;
  private readonly DESYNC_TIMEOUT_MS = 15000;

  constructor(corpus: QuranVerse[]) {
    this.corpus = corpus;
    this.buildIndex();
  }

  private buildIndex(): void {
    for (let i = 0; i < this.corpus.length; i++) {
      const verse = this.corpus[i];
      if (!verse) continue;

      const cleanText = verse[3];
      const words = new Set(cleanText.split(' '));

      for (const word of words) {
        if (!word) continue;
        let postings = this.invertedIndex.get(word);
        if (!postings) {
          postings = [];
          this.invertedIndex.set(word, postings);
        }
        postings.push(i);
      }
    }
  }

  public match(rawTranscript: string): MatchResult | null {
    const normalized = normalizeArabic(rawTranscript);
    if (!normalized) return null;

    const allTokens = normalized.split(' ').filter(Boolean);
    if (allTokens.length === 0) return null;

    // Use a trailing sliding window of up to the last 8 words
    const tokens = allTokens.slice(-8);

    const now = Date.now();
    if (this.lastMatchedIndex !== null && now - this.lastMatchTime > this.DESYNC_TIMEOUT_MS) {
      this.lastMatchedIndex = null;
    }

    const scores = new Map<number, number>();

    for (const token of tokens) {
      const postings = this.invertedIndex.get(token);
      if (!postings) continue;

      for (const index of postings) {
        scores.set(index, (scores.get(index) ?? 0) + 1);
      }
    }

    if (scores.size === 0) return null;

    let bestIndex = -1;
    let highestScore = -1;

    for (const [index, tokenMatchCount] of scores.entries()) {
      let finalScore = tokenMatchCount;

      if (this.lastMatchedIndex !== null) {
        if (index === this.lastMatchedIndex + 1) {
          finalScore += 2.5;
        } else if (index === this.lastMatchedIndex) {
          finalScore += 1.0;
        }
      }

      if (finalScore > highestScore) {
        highestScore = finalScore;
        bestIndex = index;
      }
    }

    if (bestIndex === -1) return null;

    const rawTokenMatches = scores.get(bestIndex) ?? 0;
    const isSequential =
      this.lastMatchedIndex !== null &&
      (bestIndex === this.lastMatchedIndex + 1 || bestIndex === this.lastMatchedIndex);

    // Dynamic acceptance thresholds
    if (isSequential) {
      if (rawTokenMatches < 2 && tokens.length > 2) return null;
    } else {
      if (rawTokenMatches < 3 && tokens.length >= 3) return null;
      if (rawTokenMatches / tokens.length < 0.45) return null;
    }

    this.lastMatchedIndex = bestIndex;
    this.lastMatchTime = now;

    const matched = this.corpus[bestIndex];
    if (!matched) return null;

    const [surah, ayah, uthmani, clean] = matched;

    return {
      index: bestIndex,
      surah,
      ayah,
      uthmani,
      clean,
      score: highestScore,
      isSequential,
    };
  }

  public reset(): void {
    this.lastMatchedIndex = null;
    this.lastMatchTime = 0;
  }
}
