import { storage } from 'wxt/utils/storage';
import { DEFAULT_TRANSLITERATION_ID } from './editions';
import type { MatchResult } from './matcher';

export const CaptureState = {
  IDLE: 'idle',
  STARTING: 'starting',
  CAPTURING: 'capturing',
  STOPPING: 'stopping',
} as const;

export type CaptureStateValue = (typeof CaptureState)[keyof typeof CaptureState];

export interface MatchedAyah extends MatchResult {
  surahNameArabic?: string;
  surahNameEnglish?: string;
  totalAyahs?: number;
  ayahMarker?: string;
  isSajdah?: boolean;
}

export type AppTheme = 'system' | 'light' | 'dark' | 'sepia';
export type ArabicFontSize = 'normal' | 'large' | 'xlarge';
export type ReadingDensity = 'comfortable' | 'compact';
export type UiLanguage = 'system' | 'en' | 'ar';
export type CardLayer = 'arabic' | 'transliteration' | 'translation' | 'tafsir';

export const DEFAULT_LAYER_ORDER: readonly CardLayer[] = [
  'arabic',
  'transliteration',
  'translation',
  'tafsir',
];

export function normalizeLayerOrder(order?: readonly string[]): CardLayer[] {
  if (!Array.isArray(order)) return [...DEFAULT_LAYER_ORDER];
  const validSet = new Set<CardLayer>(DEFAULT_LAYER_ORDER);
  const result: CardLayer[] = [];
  for (const item of order) {
    if (validSet.has(item as CardLayer) && !result.includes(item as CardLayer)) {
      result.push(item as CardLayer);
    }
  }
  for (const fallbackItem of DEFAULT_LAYER_ORDER) {
    if (!result.includes(fallbackItem)) {
      result.push(fallbackItem);
    }
  }
  return result;
}

export interface UserEditionPreferences {
  showArabic?: boolean;
  activeTranslationId: string | null;
  activeTranslationIds?: string[];
  showTransliteration: boolean;
  activeTransliterationId: string;
  showTafsir?: boolean;
  activeTafsirId?: string | null;
  theme?: AppTheme;
  arabicFontSize?: ArabicFontSize;
  readingDensity?: ReadingDensity;
  uiLanguage?: UiLanguage;
  layerOrder?: CardLayer[];
}

export const captureStateItem = storage.defineItem<CaptureStateValue>('session:captureState', {
  fallback: CaptureState.IDLE,
});

export const activeTabIdItem = storage.defineItem<number | null>('session:activeTabId', {
  fallback: null,
});

export const transcriptItem = storage.defineItem<string>('session:transcript', {
  fallback: '',
});

export const matchedAyahItem = storage.defineItem<MatchedAyah | null>('session:matchedAyah', {
  fallback: null,
});

export const userPreferencesItem = storage.defineItem<UserEditionPreferences>(
  'local:userEditionPreferences',
  {
    fallback: {
      showArabic: true,
      activeTranslationId: null,
      activeTranslationIds: [],
      showTransliteration: false,
      activeTransliterationId: DEFAULT_TRANSLITERATION_ID,
      showTafsir: false,
      activeTafsirId: null,
      theme: 'system',
      arabicFontSize: 'normal',
      readingDensity: 'comfortable',
      uiLanguage: 'system',
      layerOrder: [...DEFAULT_LAYER_ORDER],
    },
  },
);
