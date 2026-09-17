import { del, get, keys, set } from 'idb-keyval';
import { SURAHS } from './quran-meta';
import type { UserEditionPreferences } from './state';

export interface StoredEdition {
  identifier: string;
  name: string;
  englishName: string;
  language: string;
  nativeName?: string;
  type: 'translation' | 'transliteration';
  direction: 'ltr' | 'rtl';
  ayahs: string[];
}

export interface EditionMetadata {
  identifier: string;
  name: string;
  englishName: string;
  language: string;
  nativeName: string;
  type: 'translation' | 'transliteration';
  direction: 'ltr' | 'rtl';
}

export const LANGUAGE_ENDONYMS: Readonly<Record<string, string>> = {
  ar: 'العربية',
  en: 'English',
  fr: 'Français',
  ur: 'اردو',
  id: 'Bahasa Indonesia',
  tr: 'Türkçe',
  de: 'Deutsch',
  es: 'Español',
  ru: 'Русский',
};

export function getLanguageEndonym(languageCode: string): string {
  return LANGUAGE_ENDONYMS[languageCode] ?? languageCode.toUpperCase();
}

export const CURATED_EDITIONS: readonly EditionMetadata[] = [
  {
    identifier: 'en.sahih',
    name: 'Saheeh International',
    englishName: 'Saheeh International',
    language: 'en',
    nativeName: 'English',
    type: 'translation',
    direction: 'ltr',
  },
  {
    identifier: 'en.transliteration',
    name: 'Transliteration',
    englishName: 'English Transliteration',
    language: 'en',
    nativeName: 'Transliteration',
    type: 'transliteration',
    direction: 'ltr',
  },
  {
    identifier: 'fr.hamidullah',
    name: 'Hamidullah',
    englishName: 'Muhammad Hamidullah',
    language: 'fr',
    nativeName: 'Français',
    type: 'translation',
    direction: 'ltr',
  },
  {
    identifier: 'ur.jalandhry',
    name: 'جالندہری',
    englishName: 'Fateh Muhammad Jalandhry',
    language: 'ur',
    nativeName: 'اردو',
    type: 'translation',
    direction: 'rtl',
  },
  {
    identifier: 'id.indonesian',
    name: 'Bahasa Indonesia',
    englishName: 'Indonesian Ministry of Religious Affairs',
    language: 'id',
    nativeName: 'Bahasa Indonesia',
    type: 'translation',
    direction: 'ltr',
  },
  {
    identifier: 'tr.diyanet',
    name: 'Diyanet İşleri',
    englishName: 'Diyanet Isleri',
    language: 'tr',
    nativeName: 'Türkçe',
    type: 'translation',
    direction: 'ltr',
  },
  {
    identifier: 'de.bubenheim',
    name: 'Bubenheim & Elyas',
    englishName: 'A. S. F. Bubenheim and N. Elyas',
    language: 'de',
    nativeName: 'Deutsch',
    type: 'translation',
    direction: 'ltr',
  },
  {
    identifier: 'es.cortes',
    name: 'Cortes',
    englishName: 'Julio Cortes',
    language: 'es',
    nativeName: 'Español',
    type: 'translation',
    direction: 'ltr',
  },
  {
    identifier: 'ru.kuliev',
    name: 'Кулиев',
    englishName: 'Elmir Kuliev',
    language: 'ru',
    nativeName: 'Русский',
    type: 'translation',
    direction: 'ltr',
  },
];

const TOTAL_QURAN_AYAHS = 6236;
const CACHE_PREFIX = 'edition:';
const API_BASE_URL = 'https://api.alquran.cloud/v1';

export class EditionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditionValidationError';
  }
}

export class EditionNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditionNetworkError';
  }
}

interface RawAyah {
  number?: number;
  text?: string;
  numberInSurah?: number;
}

interface RawSurah {
  number?: number;
  name?: string;
  ayahs?: RawAyah[];
}

interface RawEditionData {
  identifier?: string;
  name?: string;
  englishName?: string;
  language?: string;
  type?: string;
  direction?: string;
}

interface RawApiResponse {
  code?: number;
  status?: string;
  data?: {
    surahs?: RawSurah[];
    edition?: RawEditionData;
  };
}

export function validateAndFlattenEdition(payload: unknown): StoredEdition {
  if (!payload || typeof payload !== 'object') {
    throw new EditionValidationError('Invalid API response: payload is not an object');
  }

  const response = payload as RawApiResponse;
  if (response.code !== 200 || response.status !== 'OK' || !response.data) {
    throw new EditionValidationError(
      `API returned non-OK status: code=${response.code}, status=${response.status}`,
    );
  }

  const { surahs, edition } = response.data;
  if (!Array.isArray(surahs) || surahs.length !== 114) {
    throw new EditionValidationError(
      `Surah count mismatch: expected 114, received ${surahs?.length ?? 0}`,
    );
  }

  if (!edition || typeof edition !== 'object' || !edition.identifier) {
    throw new EditionValidationError('Missing or invalid edition metadata in API payload');
  }

  const ayahs: string[] = [];

  for (let sIdx = 0; sIdx < 114; sIdx++) {
    const surah = surahs[sIdx];
    const expectedMeta = SURAHS[sIdx];
    if (!surah || !Array.isArray(surah.ayahs)) {
      throw new EditionValidationError(`Surah at index ${sIdx} is invalid or missing ayahs array`);
    }

    if (expectedMeta && surah.ayahs.length !== expectedMeta.totalAyahs) {
      throw new EditionValidationError(
        `Surah ${sIdx + 1} (${expectedMeta.nameEnglish}) ayah count mismatch: expected ${expectedMeta.totalAyahs}, received ${surah.ayahs.length}`,
      );
    }

    for (let aIdx = 0; aIdx < surah.ayahs.length; aIdx++) {
      const ayah = surah.ayahs[aIdx];
      if (!ayah || typeof ayah.text !== 'string') {
        throw new EditionValidationError(
          `Surah ${sIdx + 1}, Ayah ${aIdx + 1} text is missing or not a string`,
        );
      }
      ayahs.push(ayah.text);
    }
  }

  if (ayahs.length !== TOTAL_QURAN_AYAHS) {
    throw new EditionValidationError(
      `Total ayah count mismatch: expected ${TOTAL_QURAN_AYAHS}, received ${ayahs.length}`,
    );
  }

  const type = edition.type === 'transliteration' ? 'transliteration' : 'translation';
  const direction = edition.direction === 'rtl' ? 'rtl' : 'ltr';

  return {
    identifier: edition.identifier,
    name: edition.name ?? edition.identifier,
    englishName: edition.englishName ?? edition.identifier,
    language: edition.language ?? 'en',
    nativeName: getLanguageEndonym(edition.language ?? 'en'),
    type,
    direction,
    ayahs,
  };
}

export async function getCachedEdition(id: string): Promise<StoredEdition | undefined> {
  return await get<StoredEdition>(`${CACHE_PREFIX}${id}`);
}

export async function getCachedEditionIds(): Promise<string[]> {
  const allKeys = await keys();
  const editionKeys: string[] = [];
  for (const k of allKeys) {
    if (typeof k === 'string' && k.startsWith(CACHE_PREFIX)) {
      editionKeys.push(k.slice(CACHE_PREFIX.length));
    }
  }
  return editionKeys;
}

export async function deleteCachedEdition(id: string): Promise<void> {
  await del(`${CACHE_PREFIX}${id}`);
}

export async function fetchAndCacheEdition(
  id: string,
  signal?: AbortSignal,
): Promise<StoredEdition> {
  const cached = await getCachedEdition(id);
  if (cached) return cached;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/quran/${encodeURIComponent(id)}`, {
      signal,
      headers: {
        Accept: 'application/json',
      },
    });
  } catch (err) {
    throw new EditionNetworkError(
      `Failed to fetch edition ${id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    throw new EditionNetworkError(`API request failed with HTTP ${res.status} ${res.statusText}`);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new EditionNetworkError(
      `Malformed JSON in edition response: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const validated = validateAndFlattenEdition(json);
  await set(`${CACHE_PREFIX}${id}`, validated);
  return validated;
}

export async function loadActiveEditions(
  preferences: UserEditionPreferences,
): Promise<Map<string, StoredEdition>> {
  const result = new Map<string, StoredEdition>();
  const idsToLoad: string[] = [];

  if (preferences.showTransliteration && preferences.activeTransliterationId) {
    idsToLoad.push(preferences.activeTransliterationId);
  }

  const activeId =
    preferences.activeTranslationId !== undefined
      ? preferences.activeTranslationId
      : (preferences.activeTranslationIds?.[0] ?? null);

  if (activeId && !idsToLoad.includes(activeId)) {
    idsToLoad.push(activeId);
  }

  await Promise.all(
    idsToLoad.map(async (id) => {
      try {
        const cached = await getCachedEdition(id);
        if (cached) {
          result.set(id, cached);
        }
      } catch (err) {
        console.warn(`Failed to retrieve cached edition ${id}:`, err);
      }
    }),
  );

  return result;
}
