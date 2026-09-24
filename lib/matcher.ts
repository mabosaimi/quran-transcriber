import { normalizeArabic } from './normalize';

/**
 * Canonical verse tuple: `[surahNumber, ayahNumber, uthmaniText, cleanText]`.
 */
export type QuranVerse = [surah: number, ayah: number, uthmani: string, clean: string];

/**
 * Result of a successful verse match against the Quranic corpus.
 */
export interface MatchResult {
  /** 0-based index in the corpus (0 to 6235). */
  index: number;
  /** Surah number (1 to 114). */
  surah: number;
  /** Ayah number within the Surah (1-based). */
  ayah: number;
  /** Diacritized Uthmanic text for UI rendering. */
  uthmani: string;
  /** Normalized text used for matching. */
  clean: string;
  /** Match confidence score. */
  score: number;
  /** Whether the match was resolved sequentially in Tracking Mode. */
  isSequential: boolean;
}

/**
 * Real-time Quran verse matcher featuring sub-millisecond dual-mode retrieval:
 * - Tracking Mode: local sequential neighborhood evaluation `[-1, 0, 1, 2]`.
 * - Discovery Mode: zero-allocation inverted index search with IDF scoring.
 */
export class QuranMatcher {
  private readonly corpus: QuranVerse[];
  private readonly N: number;
  private readonly verseWordSets: Set<string>[] = [];
  private readonly verseLengths: Uint8Array;
  private readonly idfTable: Map<string, number> = new Map();
  private readonly invertedIndex: Map<string, Uint16Array> = new Map();

  // Zero-allocation scratch buffers for hot-path evaluation
  private readonly discoveryScores: Float32Array;
  private readonly discoveryMatchCounts: Uint8Array;
  private readonly touchedIndices: Int32Array;
  private touchedCount = 0;

  // Sequential tracking state
  private lastMatchedIndex: number | null = null;
  private lastMatchTime = 0;
  private lastForwardTransitionTime = 0;
  private readonly DESYNC_TIMEOUT_MS = 5000;
  private readonly BASMALAH_DESYNC_TIMEOUT_MS = 1200;
  private currentDesyncTimeout = 5000;
  private readonly FORWARD_LATCH_MS = 3500;
  private readonly SLIDING_WINDOW_SIZE = 10;
  private lastTrackingCovCur = 0;

  /**
   * Initializes the matcher and precomputes inverted index and IDF weights.
   * @param corpus Canonical array of all 6,236 Quran verses.
   */
  constructor(corpus: QuranVerse[]) {
    this.corpus = corpus;
    this.N = corpus.length;
    this.verseLengths = new Uint8Array(this.N);
    this.discoveryScores = new Float32Array(this.N);
    this.discoveryMatchCounts = new Uint8Array(this.N);
    this.touchedIndices = new Int32Array(this.N);

    this.buildIndex();
  }

  private buildIndex(): void {
    const dfMap = new Map<string, number>();

    for (let i = 0; i < this.N; i++) {
      const verse = this.corpus[i];
      if (!verse) continue;

      const clean = verse[3];
      const words = clean.split(' ').filter(Boolean);
      const wordSet = new Set(words);
      this.verseWordSets.push(wordSet);
      this.verseLengths[i] = words.length;

      for (const w of wordSet) {
        dfMap.set(w, (dfMap.get(w) ?? 0) + 1);
      }
    }

    for (const [w, df] of dfMap.entries()) {
      this.idfTable.set(w, Math.log(this.N / df));
    }

    const tempIndex = new Map<string, number[]>();
    for (let i = 0; i < this.N; i++) {
      const wordSet = this.verseWordSets[i];
      if (!wordSet) continue;

      for (const w of wordSet) {
        let list = tempIndex.get(w);
        if (!list) {
          list = [];
          tempIndex.set(w, list);
        }
        list.push(i);
      }
    }

    for (const [w, list] of tempIndex.entries()) {
      this.invertedIndex.set(w, new Uint16Array(list));
    }
  }

  /**
   * Matches a raw Arabic ASR speech transcript against the corpus.
   * Uses Tracking Mode if synchronized, falling back to Discovery Mode on verse jumps
   * or when out of sync.
   *
   * @param rawTranscript Raw text from speech recognition.
   * @returns The best matching verse, or null if confidence thresholds are unmet.
   */
  public match(rawTranscript: string): MatchResult | null {
    const normalized = normalizeArabic(rawTranscript);
    if (!normalized) return null;

    const allTokens = normalized.split(' ').filter(Boolean);
    if (allTokens.length === 0) return null;

    const tokens = allTokens.slice(-this.SLIDING_WINDOW_SIZE);
    const m = tokens.length;
    const now = Date.now();

    if (this.lastMatchedIndex !== null && now - this.lastMatchTime > this.currentDesyncTimeout) {
      this.lastMatchedIndex = null;
    }

    // Tracking mode: local neighborhood [-1, 0, 1, 2]
    if (this.lastMatchedIndex !== null) {
      const trackingMatch = this.evaluateTracking(tokens, m, now);
      if (trackingMatch) return trackingMatch;

      // Suppress discovery fallback during forward transition latch window,
      // but only while the new verse is active (prevents flip-flopping).
      if (
        now - this.lastForwardTransitionTime < this.FORWARD_LATCH_MS &&
        this.lastTrackingCovCur > 0
      ) {
        return null;
      }
    }

    // Basmalah handling: 113 of 114 Surahs begin with unnumbered Basmalah recitation,
    // but only 1:1 indexes it as an Ayah. When followed by words of a new Surah,
    // evaluate the post-Basmalah slice first so high-IDF Basmalah tokens do not shadow the target.
    const basmalahEnd = this.findBasmalahEnd(tokens);
    if (basmalahEnd !== -1 && basmalahEnd < m) {
      const postBasmalah = tokens.slice(basmalahEnd);
      const postMatch = this.evaluateDiscovery(postBasmalah, postBasmalah.length, now);
      if (postMatch) return postMatch;
    }

    // Discovery mode: global corpus search
    return this.evaluateDiscovery(tokens, m, now);
  }

  private evaluateTracking(tokens: string[], m: number, now: number): MatchResult | null {
    if (this.lastMatchedIndex === null) return null;
    const curIdx = this.lastMatchedIndex;
    const offsets = [-1, 0, 1, 2];

    let scorePrev = 0;
    let scoreCur = 0;
    let scoreNext = 0;
    let scoreNext2 = 0;

    let covPrev = 0;
    let covCur = 0;
    let covNext = 0;
    let covNext2 = 0;

    let tailNext = 0;
    let tailNext2 = 0;
    let lastPosPrev = -1;
    let lastPosCur = -1;
    let lastPosNext = -1;
    let lastPosNext2 = -1;

    for (let k = 0; k < offsets.length; k++) {
      const off = offsets[k] as number;
      const idx = curIdx + off;
      if (idx < 0 || idx >= this.N) continue;

      const wordSet = this.verseWordSets[idx];
      const vLen = this.verseLengths[idx] ?? 1;
      if (!wordSet) continue;

      let sc = 0;
      let matchedUnique = 0;
      let tailHits = 0;
      let lastPos = -1;

      for (let i = 0; i < m; i++) {
        const t = tokens[i];
        if (t && wordSet.has(t)) {
          const recency = 0.5 + 0.5 * ((i + 1) / m);
          sc += (this.idfTable.get(t) ?? 1.0) * recency;
          matchedUnique++;
          lastPos = i;
          if (i >= m - 4) {
            tailHits++;
          }
        }
      }

      const cov = matchedUnique / Math.min(vLen, m);

      if (k === 0) {
        scorePrev = sc;
        covPrev = cov;
        lastPosPrev = lastPos;
      } else if (k === 1) {
        scoreCur = sc;
        covCur = cov;
        lastPosCur = lastPos;
      } else if (k === 2) {
        scoreNext = sc;
        covNext = cov;
        tailNext = tailHits;
        lastPosNext = lastPos;
      } else if (k === 3) {
        scoreNext2 = sc;
        covNext2 = cov;
        tailNext2 = tailHits;
        lastPosNext2 = lastPos;
      }
    }

    this.lastTrackingCovCur = covCur;
    const minScore = this.N < 100 ? 1.5 : 3.0;

    // Forward latch: active while a forward transition is fresh and the new verse
    // is at or ahead of the previous verse in the speech window.
    const isForwardLatched =
      now - this.lastForwardTransitionTime < this.FORWARD_LATCH_MS &&
      covCur > 0 &&
      lastPosCur >= lastPosPrev;

    // Backward repetition (offset -1)
    if (
      !isForwardLatched &&
      covPrev >= 0.5 &&
      scorePrev >= minScore &&
      scorePrev > scoreNext * 1.3 &&
      scorePrev > scoreCur * 1.2
    ) {
      return this.commitMatch(curIdx - 1, scorePrev, true, now, false);
    }

    // Forward progression (offset +1)
    const isChronologicallyForward = lastPosNext > lastPosCur;
    const reachedEndOfCurrentVerse = covCur >= 0.5 && tailNext >= 1;
    const nextOverwhelming = covNext >= 0.6 && scoreNext >= minScore;
    const forwardTransition =
      isChronologicallyForward && (reachedEndOfCurrentVerse || nextOverwhelming);

    if (forwardTransition && scoreNext > 0 && tailNext >= 1) {
      return this.commitMatch(curIdx + 1, scoreNext, true, now, true);
    }

    // Forward skip (offset +2)
    if (
      covNext === 0 &&
      covNext2 >= 0.6 &&
      scoreNext2 >= minScore &&
      tailNext2 >= 1 &&
      lastPosNext2 > lastPosCur
    ) {
      return this.commitMatch(curIdx + 2, scoreNext2, true, now, true);
    }

    // Same-verse continuation (offset 0):
    // Release index 0 (1:1) if reciter moved on to a non-Fatihah Surah.
    const isBasmalahFollowedByOtherSurah = curIdx === 0 && m > 4 && scoreNext === 0;

    const continuationMinScore = this.N < 100 ? 1.0 : 2.5;
    const hasStrongContinuation =
      !isBasmalahFollowedByOtherSurah && covCur >= 0.3 && scoreCur >= continuationMinScore;

    if (hasStrongContinuation || isForwardLatched) {
      return this.commitMatch(curIdx, scoreCur, true, now, false);
    }

    return null;
  }

  private evaluateDiscovery(tokens: string[], m: number, now: number): MatchResult | null {
    const minDiscoveryScore = this.N < 100 ? 1.5 : 3.5;
    const minSingleWordIdf = this.N < 100 ? 1.0 : 6.0;

    for (let i = 0; i < m; i++) {
      const t = tokens[i];
      if (!t) continue;

      const postings = this.invertedIndex.get(t);
      if (!postings) continue;

      const idf = this.idfTable.get(t) ?? 1.0;
      const count = postings.length;

      for (let j = 0; j < count; j++) {
        const v = postings[j] as number;
        if (this.discoveryMatchCounts[v] === 0) {
          this.touchedIndices[this.touchedCount++] = v;
        }
        this.discoveryMatchCounts[v] = (this.discoveryMatchCounts[v] as number) + 1;
        this.discoveryScores[v] = (this.discoveryScores[v] as number) + idf;
      }
    }

    if (this.touchedCount === 0) return null;

    let bestIndex = -1;
    let bestScore = -1;

    for (let i = 0; i < this.touchedCount; i++) {
      const v = this.touchedIndices[i] as number;
      const sc = this.discoveryScores[v] as number;
      if (sc > bestScore) {
        bestScore = sc;
        bestIndex = v;
      }
    }

    let result: MatchResult | null = null;

    if (bestIndex !== -1) {
      const matchCount = this.discoveryMatchCounts[bestIndex] as number;
      const vLen = this.verseLengths[bestIndex] as number;

      // Gate 1: Single-word verse discovery (requires hapax or high-IDF word with exact match)
      if (m === 1 && vLen === 1 && matchCount === 1) {
        const idf = this.idfTable.get(tokens[0] ?? '') ?? 0;
        if (idf >= minSingleWordIdf) {
          result = this.commitMatch(bestIndex, bestScore, false, now);
        }
      } else if (matchCount >= 2 && bestScore >= minDiscoveryScore) {
        // Gate 2: Multi-word discovery
        if (matchCount / m >= 0.35 || matchCount / vLen >= 0.35) {
          result = this.commitMatch(bestIndex, bestScore, false, now);
        }
      }
    }

    // Reset touched entries in O(touched) time without allocations
    for (let i = 0; i < this.touchedCount; i++) {
      const v = this.touchedIndices[i] as number;
      this.discoveryScores[v] = 0;
      this.discoveryMatchCounts[v] = 0;
    }
    this.touchedCount = 0;

    return result;
  }

  private commitMatch(
    index: number,
    score: number,
    isSequential: boolean,
    now: number,
    isForwardTransition = false,
  ): MatchResult | null {
    if (isForwardTransition) {
      this.lastForwardTransitionTime = now;
    }
    this.lastMatchedIndex = index;
    this.lastMatchTime = now;

    // Index 0 (1:1 / Basmalah) uses a short timeout (1.2s vs 5s) because reciters
    // typically transition into the target Surah immediately after reciting the Basmalah.
    this.currentDesyncTimeout =
      index === 0 ? this.BASMALAH_DESYNC_TIMEOUT_MS : this.DESYNC_TIMEOUT_MS;

    const matched = this.corpus[index];
    if (!matched) return null;

    const [surah, ayah, uthmani, clean] = matched;

    return {
      index,
      surah,
      ayah,
      uthmani,
      clean,
      score,
      isSequential,
    };
  }

  private findBasmalahEnd(tokens: string[]): number {
    for (let i = 0; i <= tokens.length - 4; i++) {
      if (
        (tokens[i] === 'بسم' || tokens[i] === 'باسم') &&
        tokens[i + 1] === 'الله' &&
        tokens[i + 2] === 'الرحمن' &&
        tokens[i + 3] === 'الرحيم'
      ) {
        return i + 4;
      }
    }
    return -1;
  }

  /**
   * Resets sequential tracking state and timers to initial cold-start conditions.
   */
  public reset(): void {
    this.lastMatchedIndex = null;
    this.lastMatchTime = 0;
    this.lastForwardTransitionTime = 0;
    this.lastTrackingCovCur = 0;
    this.currentDesyncTimeout = this.DESYNC_TIMEOUT_MS;
  }
}
