import { storage } from 'wxt/utils/storage';
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

export interface UserEditionPreferences {
  showArabic?: boolean;
  activeTranslationId: string | null;
  activeTranslationIds?: string[];
  showTransliteration: boolean;
  activeTransliterationId: string;
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
      activeTransliterationId: 'en.transliteration',
    },
  },
);
