import {
  CURATED_EDITIONS,
  DEFAULT_TAFSIR_ID,
  DEFAULT_TRANSLITERATION_ID,
  deleteCachedEdition,
  type EditionMetadata,
  fetchAndCacheEdition,
  formatEditionAuthors,
  getAvailableTafsirs,
  getAvailableTranslations,
  getAvailableTransliterations,
  getCachedEdition,
  getCachedEditionIds,
  getLanguageEndonym,
  loadActiveEditions,
  resolveEditionDirection,
  resolveTransliterationForLanguage,
  type StoredEdition,
} from '@/lib/editions';
import {
  getEffectiveDirection,
  getEffectiveLanguage,
  getMessage,
  localizeDOM,
  setUiLanguage,
} from '@/lib/i18n';
import { type CaptureResponseMessage, MSG } from '@/lib/messages';
import { normalizeArabic } from '@/lib/normalize';
import {
  type CorpusAyah,
  getSurahVerses,
  initCorpus,
  isCorpusLoaded,
  type QuranVerseTuple,
} from '@/lib/quran-corpus';
import { SURAHS, type SurahMeta, toArabicNumerals } from '@/lib/quran-meta';
import {
  type AppTheme,
  type ArabicFontSize,
  CaptureState,
  type CaptureStateValue,
  type CardLayer,
  captureStateItem,
  DEFAULT_LAYER_ORDER,
  type MatchedAyah,
  matchedAyahItem,
  normalizeLayerOrder,
  type ReadingDensity,
  transcriptItem,
  type UiLanguage,
  type UserEditionPreferences,
  userPreferencesItem,
} from '@/lib/state';

let toggleBtn: HTMLButtonElement;
let idleHint: HTMLElement;
let statusEl: HTMLElement;
let errorBanner: HTMLElement;
let listeningIndicator: HTMLElement;

let surahPickerTrigger: HTMLButtonElement;
let surahTriggerNumber: HTMLElement;
let surahTriggerName: HTMLElement;
let surahTriggerCount: HTMLElement;
let surahTriggerArabic: HTMLElement;

let surahPickerDialog: HTMLDialogElement;
let surahPickerCloseBtn: HTMLButtonElement;
let surahSearchInput: HTMLInputElement;
let surahPickerList: HTMLElement;
let surahPickerEmpty: HTMLElement;
let surahFilterPills: NodeListOf<HTMLButtonElement>;

type SurahFilterType = 'all' | 'meccan' | 'medinan';
let currentSurahFilter: SurahFilterType = 'all';
let currentHighlightedIndex = 0;
type PickerListItem =
  | { type: 'jump'; surah: SurahMeta; ayah: number }
  | { type: 'surah'; surah: SurahMeta };
let currentFilteredItems: PickerListItem[] = [];

interface IndexedSurah {
  readonly meta: SurahMeta;
  readonly numberStr: string;
  readonly cleanEnglish: string;
  readonly normalizedArabic: string;
  readonly unaliasedArabic: string;
}

const INDEXED_SURAHS: readonly IndexedSurah[] = SURAHS.map((meta) => {
  const normAr = normalizeArabic(meta.nameArabic);
  return Object.freeze({
    meta,
    numberStr: String(meta.number),
    cleanEnglish: meta.nameEnglish.toLowerCase().replace(/[-'\s]/g, ''),
    normalizedArabic: normAr,
    unaliasedArabic: normAr.startsWith('ال') ? normAr.slice(2) : normAr,
  });
});

let programmaticScrollTimer: ReturnType<typeof setTimeout> | null = null;

let surahFeedEl: HTMLElement;
let followReciterBtn: HTMLButtonElement;
let followReciterTextEl: HTMLElement;

let toggleArabicBtn: HTMLButtonElement;
let toggleTranslitBtn: HTMLButtonElement;
let toggleTafsirBtn: HTMLButtonElement;
let translationSelectEl: HTMLSelectElement;

let settingsBtn: HTMLButtonElement;
let settingsDialog: HTMLDialogElement;
let settingsCloseBtn: HTMLButtonElement;
let editionsListEl: HTMLElement;
let settingsEditionsSectionEl: HTMLElement | null = null;
let densityHintEl: HTMLElement | null = null;
let layerOrderListEl: HTMLElement | null = null;
let resetLayerOrderBtn: HTMLButtonElement | null = null;
let editionFilterPills: NodeListOf<HTMLButtonElement>;

type EditionFilterType = 'all' | 'translation' | 'tafsir' | 'transliteration';
let currentEditionFilter: EditionFilterType = 'all';

let currentCaptureState: CaptureStateValue = CaptureState.IDLE;
let currentMatchedAyah: MatchedAyah | null = null;
let currentFeedSurah = 1;
let currentActiveAyahNumber: number | null = null;
let isUserFollowing = true;
let isProgrammaticScrolling = false;
let isToggling = false;
let activeTabRequired = false;

let activeEditions = new Map<string, StoredEdition>();
let cachedEditionIdsSet = new Set<string>();
let currentUserPreferences: UserEditionPreferences = {
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
};
const downloadingEditions = new Set<string>();

function withInstantLayoutChange(fn: () => void): void {
  document.documentElement.classList.add('no-transitions');
  try {
    fn();
    void document.documentElement.offsetHeight;
  } finally {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('no-transitions');
    });
  }
}

async function refreshCachedEditionIds(): Promise<Set<string>> {
  cachedEditionIdsSet = new Set(await getCachedEditionIds());
  return cachedEditionIdsSet;
}

function updateDensityHint(): void {
  if (!densityHintEl) return;
  const isCompact = (currentUserPreferences.readingDensity ?? 'comfortable') === 'compact';
  const key = isCompact ? 'densityCompactHint' : 'densityComfortableHint';
  densityHintEl.dataset.i18n = key;
  densityHintEl.textContent =
    getMessage(key) ||
    (isCompact
      ? 'Tighter spacing to fit more verses on screen'
      : 'Generous card spacing with full verse progress');
}

function applyAppearancePreferences(options?: {
  theme?: AppTheme;
  arabicFontSize?: ArabicFontSize;
  readingDensity?: ReadingDensity;
  uiLanguage?: UiLanguage;
}): void {
  const theme = options?.theme ?? currentUserPreferences.theme ?? 'system';
  const arabicFontSize =
    options?.arabicFontSize ?? currentUserPreferences.arabicFontSize ?? 'normal';
  const readingDensity =
    options?.readingDensity ?? currentUserPreferences.readingDensity ?? 'comfortable';
  const uiLanguage = options?.uiLanguage ?? currentUserPreferences.uiLanguage ?? 'system';

  setUiLanguage(uiLanguage);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.arabicSize = arabicFontSize;
  document.documentElement.dataset.density = readingDensity;
  document.documentElement.dir = getEffectiveDirection();
  document.documentElement.lang = getEffectiveLanguage();
  const metaColorScheme = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (metaColorScheme) {
    if (theme === 'dark') {
      metaColorScheme.content = 'dark';
    } else if (theme === 'light' || theme === 'sepia') {
      metaColorScheme.content = 'light';
    } else {
      metaColorScheme.content = 'light dark';
    }
  }
  updateDensityHint();
}

// Synchronously apply cached appearance preferences to eliminate layout flash before async hydration
try {
  const cachedTheme = localStorage.getItem('theme') as AppTheme | null;
  const cachedSize = localStorage.getItem('arabicFontSize') as ArabicFontSize | null;
  const cachedDensity = localStorage.getItem('readingDensity') as ReadingDensity | null;
  const cachedLang = localStorage.getItem('uiLanguage') as UiLanguage | null;
  if (cachedTheme) currentUserPreferences.theme = cachedTheme;
  if (cachedSize) currentUserPreferences.arabicFontSize = cachedSize;
  if (cachedDensity) currentUserPreferences.readingDensity = cachedDensity;
  if (cachedLang) currentUserPreferences.uiLanguage = cachedLang;
  applyAppearancePreferences();
} catch {
  // Ignore in case storage access is restricted
}

let unwatchState: (() => void) | undefined;
let unwatchTranscript: (() => void) | undefined;
let unwatchMatchedAyah: (() => void) | undefined;
let unwatchPreferences: (() => void) | undefined;

function queryDOMElements(): boolean {
  const btn = document.getElementById('toggle-btn') as HTMLButtonElement | null;
  const hint = document.getElementById('idle-hint');
  const status = document.getElementById('status');
  const error = document.getElementById('error-banner');
  const indicator = document.getElementById('listening-indicator');

  const sTrigger = document.getElementById('surah-picker-trigger') as HTMLButtonElement | null;
  const sTrigNum = document.getElementById('surah-trigger-number');
  const sTrigName = document.getElementById('surah-trigger-name');
  const sTrigCount = document.getElementById('surah-trigger-count');
  const sTrigArabic = document.getElementById('surah-trigger-arabic');

  const sDialog = document.getElementById('surah-picker-dialog') as HTMLDialogElement | null;
  const sClose = document.getElementById('surah-picker-close-btn') as HTMLButtonElement | null;
  const sInput = document.getElementById('surah-search-input') as HTMLInputElement | null;
  const sList = document.getElementById('surah-picker-list');
  const sEmpty = document.getElementById('surah-picker-empty');
  const sPills = document.querySelectorAll<HTMLButtonElement>('.surah-filter-pill');

  const sFeed = document.getElementById('surah-feed');
  const fBtn = document.getElementById('follow-reciter-btn') as HTMLButtonElement | null;
  const fTxt = document.getElementById('follow-reciter-text');

  const tArabicBtn = document.getElementById('toggle-arabic-btn') as HTMLButtonElement | null;
  const tTranslitBtn = document.getElementById('toggle-translit-btn') as HTMLButtonElement | null;
  const tTafsirBtn = document.getElementById('toggle-tafsir-btn') as HTMLButtonElement | null;
  const tSelect = document.getElementById('translation-select') as HTMLSelectElement | null;

  const sBtn = document.getElementById('settings-btn') as HTMLButtonElement | null;
  const sSettingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement | null;
  const sSettingsCloseBtn = document.getElementById(
    'settings-close-btn',
  ) as HTMLButtonElement | null;
  const eList = document.getElementById('editions-list');

  if (
    !btn ||
    !hint ||
    !status ||
    !error ||
    !indicator ||
    !sTrigger ||
    !sTrigNum ||
    !sTrigName ||
    !sTrigCount ||
    !sTrigArabic ||
    !sDialog ||
    !sClose ||
    !sInput ||
    !sList ||
    !sEmpty ||
    !sFeed ||
    !fBtn ||
    !fTxt ||
    !tArabicBtn ||
    !tTranslitBtn ||
    !tTafsirBtn ||
    !tSelect ||
    !sBtn ||
    !sSettingsDialog ||
    !sSettingsCloseBtn ||
    !eList
  ) {
    console.error('Missing required side panel DOM elements');
    return false;
  }

  toggleBtn = btn;
  idleHint = hint;
  statusEl = status;
  errorBanner = error;
  listeningIndicator = indicator;

  surahPickerTrigger = sTrigger;
  surahTriggerNumber = sTrigNum;
  surahTriggerName = sTrigName;
  surahTriggerCount = sTrigCount;
  surahTriggerArabic = sTrigArabic;

  surahPickerDialog = sDialog;
  surahPickerCloseBtn = sClose;
  surahSearchInput = sInput;
  surahPickerList = sList;
  surahPickerEmpty = sEmpty;
  surahFilterPills = sPills;

  surahFeedEl = sFeed;
  followReciterBtn = fBtn;
  followReciterTextEl = fTxt;

  toggleArabicBtn = tArabicBtn;
  toggleTranslitBtn = tTranslitBtn;
  toggleTafsirBtn = tTafsirBtn;
  translationSelectEl = tSelect;

  settingsBtn = sBtn;
  settingsDialog = sSettingsDialog;
  settingsCloseBtn = sSettingsCloseBtn;
  editionsListEl = eList;
  settingsEditionsSectionEl = document.getElementById('settings-editions-section');
  densityHintEl = document.getElementById('density-hint');
  layerOrderListEl = document.getElementById('layer-order-list');
  resetLayerOrderBtn = document.getElementById('reset-layer-order-btn') as HTMLButtonElement | null;
  editionFilterPills = document.querySelectorAll<HTMLButtonElement>('.edition-filter-pill');

  return true;
}

function localizeUI(): void {
  localizeDOM();
  updateDensityHint();
  updateSurahTrigger(currentFeedSurah);
  updateUI(currentCaptureState);
  updateFollowReciterButton();
}

function updateSurahTrigger(surahNumber: number): void {
  const meta = SURAHS[surahNumber - 1];
  if (!meta) return;
  surahTriggerNumber.textContent = String(meta.number);
  const isArabic = getEffectiveLanguage() === 'ar';
  surahTriggerName.textContent = isArabic ? meta.nameArabic : meta.nameEnglish;
  const countMsg = getMessage('versesCount', [String(meta.totalAyahs)]);
  surahTriggerCount.textContent = countMsg || `${meta.totalAyahs} verses`;
  setSecondaryName(surahTriggerArabic, meta, isArabic);
}

/**
 * Fills the secondary surah-name slot with the name in the other script, tagging
 * language and direction so Latin names never inherit the Mushaf font or RTL flow.
 */
function setSecondaryName(el: HTMLElement, meta: SurahMeta, isArabicUi: boolean): void {
  el.textContent = isArabicUi ? meta.nameEnglish : meta.nameArabic;
  el.lang = isArabicUi ? 'en' : 'ar';
  el.dir = isArabicUi ? 'ltr' : 'rtl';
}

function openSurahPicker(): void {
  if (surahPickerDialog.open) return;
  if (settingsDialog.open) settingsDialog.close();
  surahPickerTrigger.setAttribute('aria-expanded', 'true');
  currentSurahFilter = 'all';
  updateFilterPillsUI();
  surahSearchInput.value = '';
  filterAndRenderSurahList('');
  surahPickerDialog.showModal();
  surahSearchInput.focus();

  requestAnimationFrame(() => {
    const selectedEl = surahPickerList.querySelector('.surah-option--selected');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'center' });
    }
  });
}

function closeSurahPicker(): void {
  if (surahPickerDialog.open) {
    surahPickerDialog.close();
  }
}

// Runs for every close path (Escape, backdrop, close button, selection)
function onSurahPickerClosed(): void {
  surahPickerTrigger.setAttribute('aria-expanded', 'false');
  surahSearchInput.removeAttribute('aria-activedescendant');
  surahPickerTrigger.focus();
}

function onSurahPickerBackdropClick(event: MouseEvent): void {
  if (event.target !== surahPickerDialog) return;
  const rect = surahPickerDialog.getBoundingClientRect();
  const isInDialog =
    rect.top <= event.clientY &&
    event.clientY <= rect.top + rect.height &&
    rect.left <= event.clientX &&
    event.clientX <= rect.left + rect.width;
  if (!isInDialog) {
    closeSurahPicker();
  }
}

function normalizeEasternArabicDigits(input: string): string {
  return input.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function parseAyahJumpQuery(rawQuery: string): { surah: SurahMeta; ayah: number } | null {
  const trimmed = normalizeEasternArabicDigits(rawQuery).trim();
  const match = trimmed.match(/^([a-zA-Z\u0600-\u06FF0-9\s\-']+?)[:\s]+(\d+)$/);
  if (!match) return null;

  const surahPart = match[1]?.trim().toLowerCase();
  const ayahNum = parseInt(match[2] ?? '', 10);
  if (!surahPart || Number.isNaN(ayahNum) || ayahNum <= 0) return null;

  const asNum = parseInt(surahPart, 10);
  if (!Number.isNaN(asNum) && asNum >= 1 && asNum <= 114) {
    const target = INDEXED_SURAHS[asNum - 1]?.meta;
    if (target && ayahNum <= target.totalAyahs) {
      return { surah: target, ayah: ayahNum };
    }
  }

  const cleanEnglish = surahPart.replace(/[-'\s]/g, '');
  const matchedByEnglish = INDEXED_SURAHS.find(
    (item) => item.cleanEnglish === cleanEnglish || item.cleanEnglish.startsWith(cleanEnglish),
  )?.meta;
  if (matchedByEnglish && ayahNum <= matchedByEnglish.totalAyahs) {
    return { surah: matchedByEnglish, ayah: ayahNum };
  }

  const normAr = normalizeArabic(surahPart);
  const unaliased = normAr.startsWith('ال') ? normAr.slice(2) : normAr;
  const matchedByArabic = INDEXED_SURAHS.find(
    (item) =>
      normAr.length > 0 &&
      (item.normalizedArabic === normAr ||
        item.unaliasedArabic === unaliased ||
        item.normalizedArabic.includes(normAr)),
  )?.meta;
  if (matchedByArabic && ayahNum <= matchedByArabic.totalAyahs) {
    return { surah: matchedByArabic, ayah: ayahNum };
  }

  return null;
}

function updateFilterPillsUI(): void {
  surahFilterPills.forEach((pill) => {
    const isActive = pill.dataset.filter === currentSurahFilter;
    pill.classList.toggle('surah-filter-pill--active', isActive);
    pill.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function onFilterPillClick(e: Event): void {
  const target = e.currentTarget as HTMLButtonElement;
  const filter = target.dataset.filter as SurahFilterType | undefined;
  if (filter && filter !== currentSurahFilter) {
    currentSurahFilter = filter;
    updateFilterPillsUI();
    filterAndRenderSurahList(surahSearchInput.value);
  }
}

function filterAndRenderSurahList(rawQuery: string): void {
  const query = normalizeEasternArabicDigits(rawQuery).trim();
  currentFilteredItems = [];

  const jumpTarget = parseAyahJumpQuery(query);
  if (jumpTarget) {
    currentFilteredItems.push({
      type: 'jump',
      surah: jumpTarget.surah,
      ayah: jumpTarget.ayah,
    });
  }

  const queryLower = query.toLowerCase();
  const cleanEnglishQuery = queryLower.replace(/[-'\s]/g, '');
  const normQuery = normalizeArabic(query);
  const unaliasedQuery = normQuery.startsWith('ال') ? normQuery.slice(2) : normQuery;

  for (let i = 0; i < INDEXED_SURAHS.length; i++) {
    const item = INDEXED_SURAHS[i];
    if (!item) continue;
    if (currentSurahFilter !== 'all' && item.meta.revelation !== currentSurahFilter) {
      continue;
    }

    if (!query) {
      currentFilteredItems.push({ type: 'surah', surah: item.meta });
      continue;
    }

    const matchesNumber = item.numberStr === query || item.numberStr.startsWith(query);
    const matchesEnglish =
      item.meta.nameEnglish.toLowerCase().includes(queryLower) ||
      (cleanEnglishQuery.length > 0 && item.cleanEnglish.includes(cleanEnglishQuery));
    const matchesArabic =
      normQuery.length > 0 &&
      (item.normalizedArabic.includes(normQuery) || item.unaliasedArabic.includes(unaliasedQuery));

    if (matchesNumber || matchesEnglish || matchesArabic) {
      currentFilteredItems.push({ type: 'surah', surah: item.meta });
    }
  }

  surahPickerList.innerHTML = '';
  if (currentFilteredItems.length === 0) {
    surahPickerEmpty.hidden = false;
    currentHighlightedIndex = -1;
    surahSearchInput.removeAttribute('aria-activedescendant');
    return;
  }

  surahPickerEmpty.hidden = true;
  const selectedIdx = !query
    ? currentFilteredItems.findIndex(
        (it) => it.type === 'surah' && it.surah.number === currentFeedSurah,
      )
    : -1;
  currentHighlightedIndex = selectedIdx >= 0 ? selectedIdx : 0;

  const fragment = document.createDocumentFragment();

  for (let idx = 0; idx < currentFilteredItems.length; idx++) {
    const item = currentFilteredItems[idx];
    if (!item) continue;
    const opt = document.createElement('div');
    opt.id = `surah-opt-${idx}`;
    opt.className = 'surah-option';
    opt.setAttribute('role', 'option');
    opt.dataset.index = String(idx);

    if (idx === currentHighlightedIndex) {
      opt.classList.add('surah-option--active');
    }

    if (item.type === 'jump') {
      opt.classList.add('surah-option--jump');
      const lead = document.createElement('div');
      lead.className = 'surah-option__lead';

      const badge = document.createElement('span');
      badge.className = 'surah-option__badge';
      badge.textContent = '→';

      const meta = document.createElement('div');
      meta.className = 'surah-option__meta';

      const isArabic = getEffectiveLanguage() === 'ar';
      const surahDisplayName = isArabic ? item.surah.nameArabic : item.surah.nameEnglish;
      const name = document.createElement('span');
      name.className = 'surah-option__name';
      const jumpMsg = getMessage('jumpToAyah', [surahDisplayName, String(item.ayah)]);
      name.textContent = jumpMsg || `Jump to ${surahDisplayName}, Ayah ${item.ayah}`;

      const sub = document.createElement('div');
      sub.className = 'surah-option__sub';
      sub.textContent = `${item.surah.number}:${item.ayah}`;

      meta.appendChild(name);
      meta.appendChild(sub);
      lead.appendChild(badge);
      lead.appendChild(meta);
      opt.appendChild(lead);
    } else {
      const isSelected = item.surah.number === currentFeedSurah;
      if (isSelected) {
        opt.classList.add('surah-option--selected');
        opt.setAttribute('aria-selected', 'true');
      }

      const isArabic = getEffectiveLanguage() === 'ar';
      const lead = document.createElement('div');
      lead.className = 'surah-option__lead';

      const badge = document.createElement('span');
      badge.className = 'surah-option__badge';
      badge.textContent = String(item.surah.number);

      const meta = document.createElement('div');
      meta.className = 'surah-option__meta';

      const name = document.createElement('span');
      name.className = 'surah-option__name';
      name.textContent = isArabic ? item.surah.nameArabic : item.surah.nameEnglish;

      const sub = document.createElement('div');
      sub.className = 'surah-option__sub';

      const count = document.createElement('span');
      const versesMsg = getMessage('versesCount', [String(item.surah.totalAyahs)]);
      count.textContent = versesMsg || `${item.surah.totalAyahs} verses`;

      const dot = document.createElement('span');
      dot.textContent = '•';

      const tag = document.createElement('span');
      tag.className = 'surah-option__tag';
      tag.textContent = getMessage(item.surah.revelation) || item.surah.revelation;

      sub.appendChild(count);
      sub.appendChild(dot);
      sub.appendChild(tag);

      meta.appendChild(name);
      meta.appendChild(sub);
      lead.appendChild(badge);
      lead.appendChild(meta);

      const arabic = document.createElement('span');
      arabic.className = 'surah-option__arabic';
      setSecondaryName(arabic, item.surah, isArabic);

      opt.appendChild(lead);
      opt.appendChild(arabic);
    }

    fragment.appendChild(opt);
  }

  surahPickerList.appendChild(fragment);
  if (currentHighlightedIndex >= 0) {
    surahSearchInput.setAttribute('aria-activedescendant', `surah-opt-${currentHighlightedIndex}`);
  } else {
    surahSearchInput.removeAttribute('aria-activedescendant');
  }
}

function updateHighlightedItem(): void {
  const options = surahPickerList.querySelectorAll('.surah-option');
  options.forEach((opt, idx) => {
    if (idx === currentHighlightedIndex) {
      opt.classList.add('surah-option--active');
      opt.scrollIntoView({ block: 'nearest' });
    } else {
      opt.classList.remove('surah-option--active');
    }
  });
  if (currentHighlightedIndex >= 0) {
    surahSearchInput.setAttribute('aria-activedescendant', `surah-opt-${currentHighlightedIndex}`);
  } else {
    surahSearchInput.removeAttribute('aria-activedescendant');
  }
}

function onSurahPickerListClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  const opt = target?.closest<HTMLElement>('.surah-option');
  if (!opt) return;

  const idx = Number(opt.dataset.index);
  const item = currentFilteredItems[idx];
  if (item) {
    if (item.type === 'jump') {
      selectSurahAndAyah(item.surah.number, item.ayah);
    } else {
      selectSurahAndAyah(item.surah.number, null);
    }
  }
}

function onSurahSearchInput(): void {
  filterAndRenderSurahList(surahSearchInput.value);
}

function onSurahKeyNavigation(e: KeyboardEvent): void {
  if (!surahPickerDialog.open) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (currentFilteredItems.length > 0) {
      currentHighlightedIndex = (currentHighlightedIndex + 1) % currentFilteredItems.length;
      updateHighlightedItem();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (currentFilteredItems.length > 0) {
      currentHighlightedIndex =
        (currentHighlightedIndex - 1 + currentFilteredItems.length) % currentFilteredItems.length;
      updateHighlightedItem();
    }
  } else if (e.key === 'Enter') {
    if (e.target instanceof HTMLButtonElement) return;
    e.preventDefault();
    const item = currentFilteredItems[currentHighlightedIndex];
    if (item) {
      if (item.type === 'jump') {
        selectSurahAndAyah(item.surah.number, item.ayah);
      } else {
        selectSurahAndAyah(item.surah.number, null);
      }
    }
  }
}

function selectSurahAndAyah(surahNumber: number, ayahNumber: number | null): void {
  closeSurahPicker();
  currentFeedSurah = surahNumber;
  updateSurahTrigger(surahNumber);

  if (currentCaptureState === CaptureState.CAPTURING) {
    if (currentMatchedAyah && currentMatchedAyah.surah === surahNumber && ayahNumber === null) {
      const targetAyah = currentMatchedAyah.ayah;
      isUserFollowing = true;
      followReciterBtn.hidden = true;
      renderSurahFeed(surahNumber, targetAyah, true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToAyah(targetAyah, false);
        });
      });
    } else {
      isUserFollowing = false;
      renderSurahFeed(surahNumber, ayahNumber, true);
      if (ayahNumber) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            scrollToAyah(ayahNumber, false);
          });
        });
      }
      updateFollowReciterButton();
    }
  } else {
    renderSurahFeed(surahNumber, ayahNumber, true);
    if (ayahNumber) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToAyah(ayahNumber, false);
        });
      });
    }
  }
}

function onGlobalKeyDown(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null;
  const isInput =
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

  if (e.key === '/' && !isInput) {
    e.preventDefault();
    openSurahPicker();
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (surahPickerDialog.open) {
      closeSurahPicker();
    } else {
      openSurahPicker();
    }
  }
}

async function handleCopyAyah(ayah: CorpusAyah, btn: HTMLButtonElement): Promise<void> {
  const showAr = currentUserPreferences.showArabic ?? true;
  const activeTransId =
    currentUserPreferences.activeTranslationId !== undefined
      ? currentUserPreferences.activeTranslationId
      : (currentUserPreferences.activeTranslationIds?.[0] ?? null);

  const order = normalizeLayerOrder(currentUserPreferences.layerOrder);
  const parts: string[] = [];

  for (const layer of order) {
    if (layer === 'arabic' && showAr) {
      parts.push(`﴿${ayah.uthmani}﴾ [سورة ${ayah.surahNameArabic}: ${ayah.ayah}]`);
    } else if (
      layer === 'transliteration' &&
      currentUserPreferences.showTransliteration &&
      currentUserPreferences.activeTransliterationId
    ) {
      const translitEdition = activeEditions.get(currentUserPreferences.activeTransliterationId);
      const translitText = translitEdition?.ayahs[ayah.index];
      if (translitText) {
        parts.push(`${translitText} [${ayah.surahNameEnglish} ${ayah.surah}:${ayah.ayah}]`);
      }
    } else if (layer === 'translation' && activeTransId) {
      const transEdition = activeEditions.get(activeTransId);
      const transText = transEdition?.ayahs[ayah.index];
      if (transText) {
        parts.push(`"${transText}" [${ayah.surahNameEnglish} ${ayah.surah}:${ayah.ayah}]`);
      }
    } else if (
      layer === 'tafsir' &&
      currentUserPreferences.showTafsir &&
      currentUserPreferences.activeTafsirId
    ) {
      const tafsirEdition = activeEditions.get(currentUserPreferences.activeTafsirId);
      const tafsirText = tafsirEdition?.ayahs[ayah.index];
      if (tafsirText && tafsirEdition) {
        parts.push(`${tafsirEdition.name}: ${tafsirText}`);
      }
    }
  }

  if (parts.length === 0) {
    parts.push(`﴿${ayah.uthmani}﴾ [سورة ${ayah.surahNameArabic}: ${ayah.ayah}]`);
  }

  const textToCopy = parts.join('\n\n');

  try {
    await navigator.clipboard.writeText(textToCopy);
    btn.classList.add('ayah-copy-btn--copied');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5"/>
      </svg>
    `;
    const copiedMsg = getMessage('copied') || 'Copied!';
    btn.title = copiedMsg;
    btn.setAttribute('aria-label', copiedMsg);
    setTimeout(() => {
      btn.classList.remove('ayah-copy-btn--copied');
      const copyLabel = getMessage('copyAyah') || 'Copy verse';
      btn.title = copyLabel;
      btn.setAttribute('aria-label', `${copyLabel} ${ayah.surah}:${ayah.ayah}`);
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      `;
    }, 1500);
  } catch (err) {
    console.error('Failed to copy ayah to clipboard:', err);
  }
}

function createAyahNumberPill(ayahNumber: number, direction: 'ltr' | 'rtl' = 'ltr'): HTMLElement {
  const pill = document.createElement('span');
  pill.className = 'ayah-inline-num';

  const bdi = document.createElement('bdi');
  bdi.setAttribute('dir', direction);
  if (direction === 'rtl') {
    bdi.textContent = `(${toArabicNumerals(ayahNumber)})`;
  } else {
    bdi.textContent = `(${ayahNumber})`;
  }

  pill.appendChild(bdi);
  return pill;
}

function buildCardBody(
  ayah: CorpusAyah,
  showAr: boolean,
  activeTransId: string | null,
): HTMLElement {
  const body = document.createElement('div');
  body.className = 'ayah-card__body';

  const order = normalizeLayerOrder(currentUserPreferences.layerOrder);
  let hasPrecedingContent = false;

  for (const layer of order) {
    if (layer === 'arabic') {
      if (!showAr) continue;
      const p = document.createElement('p');
      p.className = hasPrecedingContent
        ? 'ayah-card__text ayah-card__text--bordered'
        : 'ayah-card__text';
      p.setAttribute('dir', 'rtl');
      p.setAttribute('lang', 'ar');
      p.textContent = `${ayah.uthmani}\u00A0${ayah.ayahMarker}`.trim();
      body.appendChild(p);
      hasPrecedingContent = true;
    } else if (layer === 'transliteration') {
      if (
        !currentUserPreferences.showTransliteration ||
        !currentUserPreferences.activeTransliterationId
      ) {
        continue;
      }
      const translitEdition = activeEditions.get(currentUserPreferences.activeTransliterationId);
      const text = translitEdition?.ayahs[ayah.index];
      if (!text) continue;

      const translitContainer = document.createElement('div');
      translitContainer.className = 'ayah-card__transliteration';
      translitContainer.setAttribute('dir', 'ltr');
      if (!hasPrecedingContent) {
        translitContainer.style.borderTop = 'none';
        translitContainer.style.paddingTop = '0';
      }

      const translitP = document.createElement('p');
      translitP.className = 'ayah-card__transliteration-text';
      translitP.textContent = text;
      translitP.appendChild(document.createTextNode(' '));
      translitP.appendChild(createAyahNumberPill(ayah.ayah, 'ltr'));

      translitContainer.appendChild(translitP);
      body.appendChild(translitContainer);
      hasPrecedingContent = true;
    } else if (layer === 'translation') {
      if (!activeTransId) continue;
      const edition = activeEditions.get(activeTransId);
      const text = edition?.ayahs[ayah.index];
      if (!edition || !text) continue;

      const transContainer = document.createElement('div');
      transContainer.className = 'ayah-card__translations';

      const block = document.createElement('div');
      block.className = 'ayah-translation-block';
      const direction = resolveEditionDirection(
        edition.identifier,
        edition.language,
        edition.direction,
      );
      block.setAttribute('dir', direction);
      if (!hasPrecedingContent) {
        block.style.borderTop = 'none';
        block.style.paddingTop = '0';
      }

      const label = document.createElement('span');
      label.className = 'ayah-translation-label';
      const labelBdi = document.createElement('bdi');
      labelBdi.textContent = getLanguageEndonym(edition.language);
      label.appendChild(labelBdi);

      const p = document.createElement('p');
      p.className = 'ayah-translation-text';
      p.textContent = text;
      p.appendChild(document.createTextNode(' '));
      p.appendChild(createAyahNumberPill(ayah.ayah, direction));

      block.appendChild(label);
      block.appendChild(p);
      transContainer.appendChild(block);
      body.appendChild(transContainer);
      hasPrecedingContent = true;
    } else if (layer === 'tafsir') {
      if (!currentUserPreferences.showTafsir || !currentUserPreferences.activeTafsirId) {
        continue;
      }
      const tafsirEdition = activeEditions.get(currentUserPreferences.activeTafsirId);
      const tafsirText = tafsirEdition?.ayahs[ayah.index];
      if (!tafsirEdition || !tafsirText) continue;

      const tafsirBlock = document.createElement('div');
      tafsirBlock.className = 'ayah-tafsir-block';
      if (!hasPrecedingContent) {
        tafsirBlock.style.marginBlockStart = '0';
        tafsirBlock.style.borderBlockStart = 'none';
      }
      const direction = resolveEditionDirection(
        tafsirEdition.identifier,
        tafsirEdition.language,
        tafsirEdition.direction,
      );
      tafsirBlock.setAttribute('dir', direction);
      tafsirBlock.setAttribute('lang', tafsirEdition.language ?? 'ar');

      const labelRow = document.createElement('div');
      labelRow.className = 'ayah-tafsir-header';

      const label = document.createElement('span');
      label.className = 'ayah-tafsir-label';
      const labelBdi = document.createElement('bdi');
      labelBdi.textContent = tafsirEdition.name;
      label.appendChild(labelBdi);
      labelRow.appendChild(label);

      const isArabicUi =
        document.documentElement.lang?.startsWith('ar') || tafsirEdition.language?.startsWith('ar');
      const quranComBase = isArabicUi ? 'https://quran.com/ar' : 'https://quran.com';
      const targetUrl = `${quranComBase}/${ayah.surah}/${ayah.ayah}/tafsirs`;

      const deepDiveLink = document.createElement('a');
      deepDiveLink.className = 'ayah-tafsir-link';
      deepDiveLink.href = targetUrl;
      deepDiveLink.target = '_blank';
      deepDiveLink.rel = 'noopener noreferrer';
      const deepDiveTitle = getMessage('tafsirDeepDive') || 'Read full Tafsir on Quran.com';
      deepDiveLink.title = deepDiveTitle;
      deepDiveLink.setAttribute('aria-label', `${deepDiveTitle} (${ayah.surah}:${ayah.ayah})`);
      deepDiveLink.textContent = 'Quran.com ↗';
      deepDiveLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof browser !== 'undefined' && browser.tabs?.create) {
          void browser.tabs.create({ url: targetUrl });
        } else {
          window.open(targetUrl, '_blank', 'noopener,noreferrer');
        }
      });
      labelRow.appendChild(deepDiveLink);

      const p = document.createElement('p');
      p.className = 'ayah-tafsir-text';
      p.textContent = tafsirText;

      tafsirBlock.appendChild(labelRow);
      tafsirBlock.appendChild(p);
      body.appendChild(tafsirBlock);
      hasPrecedingContent = true;
    }
  }

  return body;
}

function populateSurahFeedHeaderMeta(metaRow: HTMLElement, meta: SurahMeta): void {
  metaRow.innerHTML = '';
  const isArabic = getEffectiveLanguage() === 'ar';

  const nameEnSpan = document.createElement('span');
  nameEnSpan.lang = 'en';
  nameEnSpan.dir = 'ltr';
  nameEnSpan.textContent = meta.nameEnglish;

  const dot1 = document.createElement('span');
  dot1.textContent = '•';

  const countSpan = document.createElement('span');
  countSpan.textContent =
    getMessage('versesCount', [String(meta.totalAyahs)]) || `${meta.totalAyahs} verses`;

  const dot2 = document.createElement('span');
  dot2.textContent = '•';

  const revSpan = document.createElement('span');
  revSpan.textContent = getMessage(meta.revelation) || meta.revelation;

  if (!isArabic) {
    metaRow.appendChild(nameEnSpan);
    metaRow.appendChild(dot1);
  }
  metaRow.appendChild(countSpan);
  metaRow.appendChild(dot2);
  metaRow.appendChild(revSpan);
  if (isArabic) {
    metaRow.appendChild(dot1);
    metaRow.appendChild(nameEnSpan);
  }
}

function populateSurahFeedNav(navEl: HTMLElement, surahNumber: number): void {
  navEl.innerHTML = '';
  const isArabic = getEffectiveLanguage() === 'ar';
  const prevMeta = surahNumber > 1 ? SURAHS[surahNumber - 2] : undefined;
  const nextMeta = surahNumber < 114 ? SURAHS[surahNumber] : undefined;

  if (prevMeta) {
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'surah-nav-btn surah-nav-btn--prev';
    const prevLabel = document.createElement('span');
    prevLabel.className = 'surah-nav-btn__label';
    prevLabel.textContent = getMessage('previousSurah') || 'Previous Surah';
    const prevName = document.createElement('span');
    prevName.className = 'surah-nav-btn__name';
    prevName.textContent = `${prevMeta.number}. ${isArabic ? prevMeta.nameArabic : prevMeta.nameEnglish}`;
    prevBtn.appendChild(prevLabel);
    prevBtn.appendChild(prevName);
    prevBtn.addEventListener('click', () => {
      selectSurahAndAyah(prevMeta.number, null);
      surahFeedEl.scrollTo({ top: 0, behavior: 'smooth' });
    });
    navEl.appendChild(prevBtn);
  } else {
    const spacer = document.createElement('div');
    navEl.appendChild(spacer);
  }

  if (nextMeta) {
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'surah-nav-btn surah-nav-btn--next';
    const nextLabel = document.createElement('span');
    nextLabel.className = 'surah-nav-btn__label';
    nextLabel.textContent = getMessage('nextSurah') || 'Next Surah';
    const nextName = document.createElement('span');
    nextName.className = 'surah-nav-btn__name';
    nextName.textContent = `${nextMeta.number}. ${isArabic ? nextMeta.nameArabic : nextMeta.nameEnglish}`;
    nextBtn.appendChild(nextLabel);
    nextBtn.appendChild(nextName);
    nextBtn.addEventListener('click', () => {
      selectSurahAndAyah(nextMeta.number, null);
      surahFeedEl.scrollTo({ top: 0, behavior: 'smooth' });
    });
    navEl.appendChild(nextBtn);
  }
}

function renderSurahFeed(
  surahNumber: number,
  activeAyah: number | null,
  forceResetScroll = false,
): void {
  const isSameSurah = surahNumber === currentFeedSurah;
  currentFeedSurah = surahNumber;
  currentActiveAyahNumber = activeAyah;
  updateSurahTrigger(surahNumber);

  const meta = SURAHS[surahNumber - 1];
  if (!meta) return;

  const verses = getSurahVerses(surahNumber);
  const showAr = currentUserPreferences.showArabic ?? true;
  const activeTransId =
    currentUserPreferences.activeTranslationId !== undefined
      ? currentUserPreferences.activeTranslationId
      : (currentUserPreferences.activeTranslationIds?.[0] ?? null);

  const existingCards = surahFeedEl.querySelectorAll<HTMLElement>('.ayah-card');

  // Update card bodies in-place to preserve scroll position and avoid layout shifts
  if (!forceResetScroll && isSameSurah && existingCards.length === verses.length) {
    let anchorCard: HTMLElement | null = null;
    let anchorOffset = 0;

    if (isUserFollowing && activeAyah) {
      anchorCard = document.getElementById(`ayah-${activeAyah}`);
      anchorOffset = 0;
    } else {
      const containerScrollTop = surahFeedEl.scrollTop;
      for (let i = 0; i < existingCards.length; i++) {
        const card = existingCards[i];
        if (card && card.offsetTop + card.offsetHeight > containerScrollTop) {
          anchorCard = card;
          anchorOffset = card.offsetTop - containerScrollTop;
          break;
        }
      }
    }

    const headerMeta = surahFeedEl.querySelector<HTMLElement>('.surah-feed-header__meta');
    if (headerMeta) {
      populateSurahFeedHeaderMeta(headerMeta, meta);
    }

    const sajdahText = `۩ ${getMessage('sajdahBadge') || 'Sajdah'}`;
    const copyLabel = getMessage('copyAyah') || 'Copy verse';

    for (let i = 0; i < verses.length; i++) {
      const ayah = verses[i] as CorpusAyah;
      const card = existingCards[i];
      if (!card) continue;
      const oldBody = card.querySelector('.ayah-card__body');
      const newBody = buildCardBody(ayah, showAr, activeTransId);
      if (oldBody) {
        card.replaceChild(newBody, oldBody);
      }
      const progressSpan = card.querySelector<HTMLElement>('.ayah-card__progress');
      if (progressSpan) {
        progressSpan.textContent =
          getMessage('ayahProgress', [String(ayah.ayah), String(ayah.totalAyahs)]) ||
          `Verse ${ayah.ayah} of ${ayah.totalAyahs}`;
      }
      const sajdahBdi = card.querySelector<HTMLElement>('.ayah-card__sajdah-badge bdi');
      if (sajdahBdi) {
        sajdahBdi.textContent = sajdahText;
      }
      const copyBtn = card.querySelector<HTMLButtonElement>('.ayah-copy-btn');
      if (copyBtn && !copyBtn.classList.contains('ayah-copy-btn--copied')) {
        copyBtn.title = copyLabel;
        copyBtn.setAttribute('aria-label', `${copyLabel} ${ayah.surah}:${ayah.ayah}`);
      }
      const isActive = activeAyah === ayah.ayah;
      card.className = isActive ? 'ayah-card ayah-card--active' : 'ayah-card ayah-card--context';
    }

    const navEl = surahFeedEl.querySelector<HTMLElement>('.surah-feed-nav');
    if (navEl) {
      populateSurahFeedNav(navEl, surahNumber);
    }

    if (isUserFollowing && activeAyah) {
      scrollToAyah(activeAyah, false);
    } else if (anchorCard) {
      surahFeedEl.scrollTop = anchorCard.offsetTop - anchorOffset;
    }
    return;
  }

  // Full rebuild when switching surahs or mounting initial feed
  surahFeedEl.innerHTML = '';

  const fragment = document.createDocumentFragment();

  const header = document.createElement('header');
  header.className = 'surah-feed-header';

  const titleAr = document.createElement('div');
  titleAr.className = 'surah-feed-header__arabic';
  titleAr.setAttribute('dir', 'rtl');
  titleAr.setAttribute('lang', 'ar');
  titleAr.textContent = `سورة ${meta.nameArabic}`;

  const metaRow = document.createElement('div');
  metaRow.className = 'surah-feed-header__meta';
  populateSurahFeedHeaderMeta(metaRow, meta);

  header.appendChild(titleAr);
  header.appendChild(metaRow);
  fragment.appendChild(header);

  // Unnumbered Basmalah header for Surahs 2-114 (except Surah 9 At-Tawbah)
  if (surahNumber !== 1 && surahNumber !== 9) {
    const basmalahEl = document.createElement('div');
    basmalahEl.className = 'surah-basmalah';
    basmalahEl.setAttribute('dir', 'rtl');
    basmalahEl.setAttribute('lang', 'ar');
    basmalahEl.textContent = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ';
    fragment.appendChild(basmalahEl);
  }

  for (let i = 0; i < verses.length; i++) {
    const ayah = verses[i] as CorpusAyah;
    const isActive = activeAyah === ayah.ayah;

    const card = document.createElement('article');
    card.id = `ayah-${ayah.ayah}`;
    card.dataset.ayah = String(ayah.ayah);
    card.className = isActive ? 'ayah-card ayah-card--active' : 'ayah-card ayah-card--context';

    const cardHeader = document.createElement('header');
    cardHeader.className = 'ayah-card__header';

    const cardMeta = document.createElement('div');
    cardMeta.className = 'ayah-card__meta';

    const ayahBadge = document.createElement('div');
    ayahBadge.className = 'ayah-card__badge';
    ayahBadge.setAttribute('dir', 'ltr');
    const badgeBdi = document.createElement('bdi');
    badgeBdi.setAttribute('dir', 'ltr');
    badgeBdi.textContent = `${ayah.surah}:${ayah.ayah}`;
    ayahBadge.appendChild(badgeBdi);

    const progressSpan = document.createElement('span');
    progressSpan.className = 'ayah-card__progress';
    progressSpan.textContent =
      getMessage('ayahProgress', [String(ayah.ayah), String(ayah.totalAyahs)]) ||
      `Verse ${ayah.ayah} of ${ayah.totalAyahs}`;

    cardMeta.appendChild(ayahBadge);
    cardMeta.appendChild(progressSpan);

    const badges = document.createElement('div');
    badges.className = 'ayah-card__badges';

    if (ayah.isSajdah) {
      const sajdahBadge = document.createElement('span');
      sajdahBadge.className = 'ayah-card__sajdah-badge';
      const sajdahBdi = document.createElement('bdi');
      const sajdahText = getMessage('sajdahBadge') || 'Sajdah';
      sajdahBdi.textContent = `۩ ${sajdahText}`;
      sajdahBadge.appendChild(sajdahBdi);
      badges.appendChild(sajdahBadge);
    }

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'ayah-copy-btn';
    const copyLabel = getMessage('copyAyah') || 'Copy verse';
    copyBtn.title = copyLabel;
    copyBtn.setAttribute('aria-label', `${copyLabel} ${ayah.surah}:${ayah.ayah}`);
    copyBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
    `;
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void handleCopyAyah(ayah, copyBtn);
    });
    badges.appendChild(copyBtn);

    cardHeader.appendChild(cardMeta);
    cardHeader.appendChild(badges);
    card.appendChild(cardHeader);

    const body = buildCardBody(ayah, showAr, activeTransId);
    card.appendChild(body);
    fragment.appendChild(card);
  }

  const navFooter = document.createElement('nav');
  navFooter.className = 'surah-feed-nav';
  populateSurahFeedNav(navFooter, surahNumber);
  fragment.appendChild(navFooter);

  surahFeedEl.appendChild(fragment);
}

function scrollToAyah(ayahNumber: number, isSmooth = true): void {
  const target = document.getElementById(`ayah-${ayahNumber}`);
  if (!target || !surahFeedEl) return;

  if (programmaticScrollTimer !== null) {
    clearTimeout(programmaticScrollTimer);
    programmaticScrollTimer = null;
  }

  isProgrammaticScrolling = true;
  target.scrollIntoView({
    behavior: isSmooth ? 'smooth' : 'instant',
    block: 'start',
  });

  const onScrollEnd = () => {
    isProgrammaticScrolling = false;
    if (programmaticScrollTimer !== null) {
      clearTimeout(programmaticScrollTimer);
      programmaticScrollTimer = null;
    }
  };

  if (!isSmooth) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        onScrollEnd();
      });
    });
  } else {
    surahFeedEl.addEventListener('scrollend', onScrollEnd, { once: true });
    programmaticScrollTimer = setTimeout(onScrollEnd, 600);
  }
}

function updateFollowReciterButton(): void {
  if (isUserFollowing || currentCaptureState !== CaptureState.CAPTURING || !currentMatchedAyah) {
    followReciterBtn.hidden = true;
    return;
  }

  followReciterBtn.hidden = false;
  const followMsg = getMessage('followReciter') || 'Follow Reciter';
  const isArabic = getEffectiveLanguage() === 'ar';
  const meta = SURAHS[currentMatchedAyah.surah - 1];
  const surahName = isArabic
    ? (meta?.nameArabic ?? `${currentMatchedAyah.surah}`)
    : (meta?.nameEnglish ?? `Surah ${currentMatchedAyah.surah}`);
  followReciterTextEl.textContent = `${followMsg} (${surahName} ${currentMatchedAyah.ayah})`;
}

function checkActiveAyahVisibility(): void {
  if (!currentMatchedAyah || currentCaptureState !== CaptureState.CAPTURING) {
    followReciterBtn.hidden = true;
    return;
  }

  if (currentFeedSurah !== currentMatchedAyah.surah) {
    isUserFollowing = false;
    updateFollowReciterButton();
    return;
  }

  const activeCard = document.getElementById(`ayah-${currentMatchedAyah.ayah}`);
  if (!activeCard || !surahFeedEl) {
    isUserFollowing = false;
    updateFollowReciterButton();
    return;
  }

  const feedRect = surahFeedEl.getBoundingClientRect();
  const cardRect = activeCard.getBoundingClientRect();

  const isOutOfView = cardRect.bottom < feedRect.top + 20 || cardRect.top > feedRect.bottom - 20;

  if (isOutOfView) {
    isUserFollowing = false;
    updateFollowReciterButton();
  } else {
    isUserFollowing = true;
    followReciterBtn.hidden = true;
  }
}

function onUserScrollGesture(): void {
  if (isProgrammaticScrolling) return;

  if (currentCaptureState === CaptureState.CAPTURING && currentMatchedAyah) {
    requestAnimationFrame(() => {
      checkActiveAyahVisibility();
    });
  }
}

function handleMatch(ayah: MatchedAyah | null): void {
  currentMatchedAyah = ayah;

  if (!ayah || currentCaptureState !== CaptureState.CAPTURING) {
    listeningIndicator.hidden = currentCaptureState !== CaptureState.CAPTURING;
    if (currentActiveAyahNumber !== null) {
      const card = document.getElementById(`ayah-${currentActiveAyahNumber}`);
      if (card) card.className = 'ayah-card ayah-card--context';
      currentActiveAyahNumber = null;
    }
    followReciterBtn.hidden = true;
    return;
  }

  listeningIndicator.hidden = true;

  // Surah boundary transition
  if (ayah.surah !== currentFeedSurah) {
    if (isUserFollowing) {
      currentFeedSurah = ayah.surah;
      currentActiveAyahNumber = ayah.ayah;
      followReciterBtn.hidden = true;
      renderSurahFeed(ayah.surah, ayah.ayah, true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToAyah(ayah.ayah, false);
        });
      });
    } else {
      updateFollowReciterButton();
    }
    return;
  }

  // Same Surah progression
  if (currentActiveAyahNumber !== ayah.ayah) {
    if (currentActiveAyahNumber !== null) {
      const oldCard = document.getElementById(`ayah-${currentActiveAyahNumber}`);
      if (oldCard) oldCard.className = 'ayah-card ayah-card--context';
    }

    currentActiveAyahNumber = ayah.ayah;
    const newCard = document.getElementById(`ayah-${ayah.ayah}`);
    if (newCard) newCard.className = 'ayah-card ayah-card--active';

    if (isUserFollowing) {
      scrollToAyah(ayah.ayah, true);
    } else {
      updateFollowReciterButton();
    }
  } else if (!isUserFollowing) {
    updateFollowReciterButton();
  }
}

function onFollowReciterClick(): void {
  if (currentMatchedAyah) {
    const targetAyah = currentMatchedAyah.ayah;
    const targetSurah = currentMatchedAyah.surah;
    isUserFollowing = true;
    followReciterBtn.hidden = true;
    if (currentFeedSurah !== targetSurah) {
      currentFeedSurah = targetSurah;
      renderSurahFeed(currentFeedSurah, targetAyah, true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToAyah(targetAyah, false);
        });
      });
    } else {
      scrollToAyah(targetAyah, true);
    }
  }
}

async function hydrateState(): Promise<void> {
  const [state, transcript, matchedAyah, prefs] = await Promise.all([
    captureStateItem.getValue(),
    transcriptItem.getValue(),
    matchedAyahItem.getValue(),
    userPreferencesItem.getValue(),
    refreshCachedEditionIds(),
  ]);

  currentCaptureState = state;
  currentMatchedAyah = matchedAyah ?? null;
  if (prefs) {
    currentUserPreferences = {
      ...prefs,
      showArabic: prefs.showArabic ?? true,
      activeTranslationId:
        prefs.activeTranslationId !== undefined
          ? prefs.activeTranslationId
          : (prefs.activeTranslationIds?.[0] ?? null),
      layerOrder: normalizeLayerOrder(prefs.layerOrder),
    };
    applyAppearancePreferences();
    localizeUI();
  }

  activeEditions = await loadActiveEditions(currentUserPreferences);

  if (!isCorpusLoaded()) {
    try {
      const response = await fetch(browser.runtime.getURL('/data/quran.json'));
      const corpusData = (await response.json()) as QuranVerseTuple[];
      initCorpus(corpusData);
    } catch (err) {
      console.error('Failed to load local Quran corpus in sidepanel:', err);
    }
  }

  updateToolbarControlsSync();

  const initialSurah = currentMatchedAyah?.surah ?? 1;
  const initialAyah = currentMatchedAyah?.ayah ?? null;
  renderSurahFeed(initialSurah, initialAyah);

  updateUI(state);
  handleTranscriptError(transcript ?? '');
}

async function handleToggle(): Promise<void> {
  if (isToggling) return;

  const state = await captureStateItem.getValue();
  if (state === CaptureState.STARTING || state === CaptureState.STOPPING) {
    return;
  }

  isToggling = true;
  toggleBtn.disabled = true;

  try {
    if (state === CaptureState.CAPTURING) {
      const response = (await Promise.race([
        browser.runtime.sendMessage({
          type: MSG.STOP_CAPTURE,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Stop request timed out')), 5000),
        ),
      ])) as CaptureResponseMessage | undefined;

      if (response?.type === MSG.ERROR) {
        console.error('Background returned error stopping capture:', response.payload);
      }
    } else if (state === CaptureState.IDLE) {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const response = (await Promise.race([
        browser.runtime.sendMessage({
          type: MSG.START_CAPTURE,
          payload: tab?.id ? { tabId: tab.id } : undefined,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Start request timed out')), 8000),
        ),
      ])) as CaptureResponseMessage | undefined;

      if (response?.type === MSG.ERROR) {
        console.error('Start capture failed:', response.payload);
        const errStr = response.payload.toLowerCase();
        if (
          errStr.includes('activetab') ||
          errStr.includes('invoked') ||
          errStr.includes('captured')
        ) {
          activeTabRequired = true;
        }
      } else {
        activeTabRequired = false;
        isUserFollowing = true;
      }
    }
  } catch (err) {
    console.error('Error toggling capture:', err);
  } finally {
    isToggling = false;
    const currentState = (await captureStateItem.getValue()) ?? CaptureState.IDLE;
    updateUI(currentState);
  }
}

function updateUI(state: CaptureStateValue): void {
  currentCaptureState = state;
  const isCapturing = state === CaptureState.CAPTURING;
  const isStarting = state === CaptureState.STARTING;
  const isStopping = state === CaptureState.STOPPING;
  const isTransitioning = isStarting || isStopping;

  if (isCapturing) {
    activeTabRequired = false;
    idleHint.hidden = true;
    toggleBtn.hidden = false;
    toggleBtn.disabled = isToggling;
    toggleBtn.className = 'btn btn--danger';
    toggleBtn.textContent = getMessage('stopCapture');
    toggleBtn.setAttribute('aria-busy', 'false');
    listeningIndicator.hidden = currentMatchedAyah !== null;
    statusEl.textContent = getMessage('statusCapturing');
  } else if (isTransitioning) {
    idleHint.hidden = true;
    toggleBtn.hidden = false;
    toggleBtn.disabled = true;
    toggleBtn.setAttribute('aria-busy', 'true');
    listeningIndicator.hidden = false;
    const transitionText = getMessage(isStarting ? 'statusStarting' : 'statusStopping');
    toggleBtn.textContent = transitionText;
    statusEl.textContent = transitionText;
  } else {
    toggleBtn.setAttribute('aria-busy', 'false');
    listeningIndicator.hidden = true;
    followReciterBtn.hidden = true;
    toggleBtn.hidden = false;
    toggleBtn.disabled = isToggling;
    toggleBtn.className = 'btn btn--primary';
    toggleBtn.textContent = getMessage('startCapture');
    statusEl.textContent = getMessage('statusIdle');

    if (activeTabRequired) {
      idleHint.hidden = false;
    } else {
      idleHint.hidden = true;
    }
  }

  statusEl.className = `status status--${state}`;
}

function handleTranscriptError(text: string): void {
  if (text.startsWith('Error:')) {
    if (errorBanner.textContent !== text) {
      errorBanner.textContent = text;
    }
    if (errorBanner.hidden !== false) errorBanner.hidden = false;
  } else {
    if (errorBanner.hidden !== true) errorBanner.hidden = true;
  }
}

function populateTranslationSelectSync(): void {
  const cachedIds = cachedEditionIdsSet;
  const activeTransId =
    currentUserPreferences.activeTranslationId !== undefined
      ? currentUserPreferences.activeTranslationId
      : (currentUserPreferences.activeTranslationIds?.[0] ?? null);

  translationSelectEl.innerHTML = '';

  const noTransOpt = document.createElement('option');
  noTransOpt.value = 'none';
  noTransOpt.textContent = getMessage('noTranslation') || 'No Translation';
  translationSelectEl.appendChild(noTransOpt);

  const translationEditions = CURATED_EDITIONS.filter((e) => e.type === 'translation');
  for (const edition of translationEditions) {
    if (cachedIds.has(edition.identifier)) {
      const opt = document.createElement('option');
      opt.value = edition.identifier;
      opt.textContent = edition.nativeName;
      translationSelectEl.appendChild(opt);
    }
  }

  const downloadMoreOpt = document.createElement('option');
  downloadMoreOpt.value = '__settings__';
  downloadMoreOpt.textContent = getMessage('downloadMore') || '+ Download Languages...';
  translationSelectEl.appendChild(downloadMoreOpt);

  if (activeTransId && cachedIds.has(activeTransId)) {
    translationSelectEl.value = activeTransId;
  } else {
    translationSelectEl.value = 'none';
  }
}

function updateToolbarControlsSync(): void {
  const showArabic = currentUserPreferences.showArabic ?? true;
  const isArabicSoleLayer =
    showArabic &&
    !currentUserPreferences.activeTranslationId &&
    !currentUserPreferences.showTransliteration;
  toggleArabicBtn.className = showArabic
    ? isArabicSoleLayer
      ? 'pill-btn pill-btn--active pill-btn--locked'
      : 'pill-btn pill-btn--active'
    : 'pill-btn';
  toggleArabicBtn.setAttribute('aria-pressed', showArabic ? 'true' : 'false');
  toggleArabicBtn.title = isArabicSoleLayer
    ? getMessage('arabicLocked') ||
      'Enable a translation or transliteration first to hide Arabic text'
    : getMessage('toggleArabic') || 'Toggle Arabic Script';

  const translitId = currentUserPreferences.activeTransliterationId;
  const isDownloadingTranslit = downloadingEditions.has(translitId);
  const showTranslit = currentUserPreferences.showTransliteration;

  if (isDownloadingTranslit) {
    toggleTranslitBtn.className = 'pill-btn pill-btn--loading';
  } else {
    toggleTranslitBtn.className = showTranslit ? 'pill-btn pill-btn--active' : 'pill-btn';
  }
  toggleTranslitBtn.setAttribute('aria-pressed', showTranslit ? 'true' : 'false');

  const tafsirId = currentUserPreferences.activeTafsirId || DEFAULT_TAFSIR_ID;
  const isDownloadingTafsir = downloadingEditions.has(tafsirId);
  const showTafsir = currentUserPreferences.showTafsir ?? false;

  if (isDownloadingTafsir) {
    toggleTafsirBtn.className = 'pill-btn pill-btn--loading';
  } else {
    toggleTafsirBtn.className = showTafsir ? 'pill-btn pill-btn--active' : 'pill-btn';
  }
  toggleTafsirBtn.setAttribute('aria-pressed', showTafsir ? 'true' : 'false');

  populateTranslationSelectSync();
}

async function updateToolbarControls(refreshCache = false): Promise<void> {
  if (refreshCache) {
    await refreshCachedEditionIds();
  }
  updateToolbarControlsSync();
}

async function onArabicToggle(): Promise<void> {
  const currentShow = currentUserPreferences.showArabic ?? true;
  const nextShow = !currentShow;

  // Safeguard: do not allow turning off Arabic if no translation and no transliteration
  if (
    !nextShow &&
    !currentUserPreferences.activeTranslationId &&
    !currentUserPreferences.showTransliteration
  ) {
    return;
  }

  currentUserPreferences = {
    ...currentUserPreferences,
    showArabic: nextShow,
  };

  updateToolbarControlsSync();
  renderSurahFeed(currentFeedSurah, currentActiveAyahNumber);
  await userPreferencesItem.setValue(currentUserPreferences);
}

async function onTranslitToggle(): Promise<void> {
  await handleTransliterationToggle(!currentUserPreferences.showTransliteration);
}

async function onTranslationChange(): Promise<void> {
  const value = translationSelectEl.value;
  if (value === '__settings__') {
    translationSelectEl.value = currentUserPreferences.activeTranslationId ?? 'none';
    currentEditionFilter = 'translation';
    onSettingsOpen();
    requestAnimationFrame(() => {
      settingsEditionsSectionEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return;
  }

  const newId = value === 'none' ? null : value;
  await selectTranslation(newId);
}

function createEditionItem(edition: EditionMetadata, cachedIds: Set<string>): HTMLElement {
  const isDownloading = downloadingEditions.has(edition.identifier);
  const isCached = cachedIds.has(edition.identifier);
  const isActive =
    edition.type === 'translation'
      ? currentUserPreferences.activeTranslationId === edition.identifier
      : edition.type === 'tafsir'
        ? currentUserPreferences.showTafsir &&
          currentUserPreferences.activeTafsirId === edition.identifier
        : currentUserPreferences.showTransliteration &&
          currentUserPreferences.activeTransliterationId === edition.identifier;

  const item = document.createElement('div');
  item.className = [
    'edition-item',
    isCached ? 'edition-item--cached' : '',
    isActive ? 'edition-item--active' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const header = document.createElement('div');
  header.className = 'edition-item__header';

  const name = document.createElement('span');
  name.className = 'edition-item__name';
  const nameBdi = document.createElement('bdi');
  nameBdi.textContent = edition.nativeName;
  name.appendChild(nameBdi);

  const action = document.createElement('div');
  action.className = 'edition-item__action';

  if (isDownloading) {
    const badge = document.createElement('span');
    badge.className = 'badge badge--downloading';
    badge.textContent = getMessage('downloading') || 'Downloading...';
    action.appendChild(badge);
  } else if (isCached) {
    const badge = document.createElement('span');
    badge.className = 'badge badge--downloaded';
    badge.textContent = `✓ ${getMessage('downloaded') || 'Downloaded'}`;
    action.appendChild(badge);

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn-remove';
    btnRemove.textContent = getMessage('remove') || 'Remove';
    btnRemove.setAttribute(
      'aria-label',
      getMessage('removeEdition', [edition.nativeName]) ||
        `Remove ${edition.nativeName} (${edition.language}) download`,
    );

    btnRemove.addEventListener('click', async (e) => {
      e.stopPropagation();
      await removeEdition(edition.identifier);
    });

    action.appendChild(btnRemove);
  } else {
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (isOffline) {
      const offlineNotice = document.createElement('span');
      offlineNotice.className = 'badge badge--info';
      offlineNotice.textContent = getMessage('offlineNotice') || 'Offline - connect to download';
      action.appendChild(offlineNotice);
    } else {
      const btnDownload = document.createElement('button');
      btnDownload.type = 'button';
      btnDownload.className = 'btn-download';
      const dlText = getMessage('download') || 'Download';
      const sizeText = getMessage('approxSize') || '~1.2 MB';
      btnDownload.textContent = `${dlText} (${sizeText})`;
      btnDownload.setAttribute(
        'aria-label',
        getMessage('downloadEdition', [edition.nativeName]) ||
          `Download ${edition.nativeName} (${edition.language})`,
      );

      btnDownload.addEventListener('click', async (e) => {
        e.stopPropagation();
        await downloadEdition(edition.identifier);
      });

      action.appendChild(btnDownload);
    }
  }

  header.appendChild(name);
  header.appendChild(action);

  const sub = document.createElement('div');
  sub.className = 'edition-item__sub';

  const langTag = document.createElement('span');
  langTag.className = 'edition-item__lang-tag';
  const tafsirLabel = getMessage('tafsir') || 'Tafsir';
  langTag.textContent =
    edition.type === 'transliteration'
      ? `Aa · ${edition.language.toUpperCase()}`
      : edition.type === 'tafsir'
        ? `${tafsirLabel} · ${edition.language.toUpperCase()}`
        : edition.language.toUpperCase();

  const authorText = formatEditionAuthors(edition.name, edition.englishName);
  const authorSpan = document.createElement('span');
  authorSpan.className = 'edition-item__author';
  authorSpan.title = authorText;

  if (authorText.includes(' · ')) {
    const [part1, part2] = authorText.split(' · ');
    const bdi1 = document.createElement('bdi');
    bdi1.textContent = part1 ?? '';
    const bdi2 = document.createElement('bdi');
    bdi2.textContent = part2 ?? '';
    authorSpan.appendChild(bdi1);
    authorSpan.appendChild(document.createTextNode(' · '));
    authorSpan.appendChild(bdi2);
  } else {
    const bdi = document.createElement('bdi');
    bdi.textContent = authorText;
    authorSpan.appendChild(bdi);
  }

  sub.appendChild(langTag);
  sub.appendChild(authorSpan);

  if (isCached) {
    item.addEventListener('click', async () => {
      if (edition.type === 'translation') {
        const nextId =
          currentUserPreferences.activeTranslationId === edition.identifier
            ? null
            : edition.identifier;
        await selectTranslation(nextId);
      } else if (edition.type === 'transliteration') {
        const isCurrentlyActive =
          currentUserPreferences.showTransliteration &&
          currentUserPreferences.activeTransliterationId === edition.identifier;
        if (isCurrentlyActive) {
          await handleTransliterationToggle(false);
        } else {
          currentUserPreferences = {
            ...currentUserPreferences,
            activeTransliterationId: edition.identifier,
            showTransliteration: true,
          };
          await userPreferencesItem.setValue(currentUserPreferences);
          renderSurahFeed(currentFeedSurah, currentActiveAyahNumber);
          await updateToolbarControls();
          await renderSettings();
        }
      } else if (edition.type === 'tafsir') {
        const willEnable =
          !currentUserPreferences.showTafsir ||
          currentUserPreferences.activeTafsirId !== edition.identifier;
        await handleTafsirToggle(willEnable, edition.identifier);
      }
    });
  }

  item.appendChild(header);
  item.appendChild(sub);
  return item;
}

function getLayerLabel(layer: CardLayer): string {
  switch (layer) {
    case 'arabic':
      return getMessage('layerArabic') || 'Arabic Script';
    case 'transliteration':
      return getMessage('layerTransliteration') || 'Transliteration';
    case 'translation':
      return getMessage('layerTranslation') || 'Translation';
    case 'tafsir':
      return getMessage('layerTafsir') || 'Tafsir';
  }
}

async function moveLayer(index: number, delta: -1 | 1): Promise<void> {
  const order = normalizeLayerOrder(currentUserPreferences.layerOrder);
  const targetIndex = index + delta;
  if (targetIndex < 0 || targetIndex >= order.length) return;

  const currentItem = order[index];
  const targetItem = order[targetIndex];
  if (!currentItem || !targetItem) return;

  order[index] = targetItem;
  order[targetIndex] = currentItem;

  currentUserPreferences = {
    ...currentUserPreferences,
    layerOrder: order,
  };

  renderLayerOrderList();
  renderSurahFeed(currentFeedSurah, currentActiveAyahNumber);
  await userPreferencesItem.setValue(currentUserPreferences);
}

async function onResetLayerOrder(): Promise<void> {
  currentUserPreferences = {
    ...currentUserPreferences,
    layerOrder: [...DEFAULT_LAYER_ORDER],
  };
  renderLayerOrderList();
  renderSurahFeed(currentFeedSurah, currentActiveAyahNumber);
  await userPreferencesItem.setValue(currentUserPreferences);
}

function renderLayerOrderList(): void {
  if (!layerOrderListEl) return;
  const order = normalizeLayerOrder(currentUserPreferences.layerOrder);
  const isCustomOrder = order.some((layer, idx) => layer !== DEFAULT_LAYER_ORDER[idx]);
  if (resetLayerOrderBtn) {
    resetLayerOrderBtn.hidden = !isCustomOrder;
  }

  layerOrderListEl.innerHTML = '';

  order.forEach((layer, idx) => {
    const row = document.createElement('li');
    row.className = 'layer-order-item';

    const lead = document.createElement('div');
    lead.className = 'layer-order-item__lead';

    const step = document.createElement('span');
    step.className = 'layer-order-item__step';
    step.textContent = String(idx + 1);

    const name = document.createElement('span');
    name.className = 'layer-order-item__name';
    const labelText = getLayerLabel(layer);
    name.textContent = labelText;

    lead.appendChild(step);
    lead.appendChild(name);

    const actions = document.createElement('div');
    actions.className = 'layer-order-item__actions';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'layer-order-btn';
    upBtn.disabled = idx === 0;
    const upLabel = getMessage('moveLayerUp', [labelText]) || `Move ${labelText} up`;
    upBtn.title = upLabel;
    upBtn.setAttribute('aria-label', upLabel);
    upBtn.innerHTML = `
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m4 10 4-4 4 4"/>
      </svg>
    `;
    upBtn.addEventListener('click', () => {
      void moveLayer(idx, -1);
    });

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'layer-order-btn';
    downBtn.disabled = idx === order.length - 1;
    const downLabel = getMessage('moveLayerDown', [labelText]) || `Move ${labelText} down`;
    downBtn.title = downLabel;
    downBtn.setAttribute('aria-label', downLabel);
    downBtn.innerHTML = `
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m4 6 4 4 4-4"/>
      </svg>
    `;
    downBtn.addEventListener('click', () => {
      void moveLayer(idx, 1);
    });

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);

    row.appendChild(lead);
    row.appendChild(actions);
    layerOrderListEl?.appendChild(row);
  });
}

function updateEditionFilterPillsUI(): void {
  editionFilterPills?.forEach((pill) => {
    const isActive = pill.dataset.editionFilter === currentEditionFilter;
    pill.classList.toggle('edition-filter-pill--active', isActive);
    pill.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function onEditionFilterPillClick(e: Event): void {
  const target = e.currentTarget as HTMLButtonElement;
  const filter = target.dataset.editionFilter as EditionFilterType | undefined;
  if (filter && filter !== currentEditionFilter) {
    currentEditionFilter = filter;
    updateEditionFilterPillsUI();
    renderSettingsSync();
  }
}

function sortEditionsByInstalledFirst(
  editions: readonly EditionMetadata[],
  cachedIds: Set<string>,
): EditionMetadata[] {
  return [...editions].sort((a, b) => {
    const aCached = cachedIds.has(a.identifier) ? 1 : 0;
    const bCached = cachedIds.has(b.identifier) ? 1 : 0;
    return bCached - aCached;
  });
}

function renderSettingsSync(): void {
  const currentTheme = currentUserPreferences.theme ?? 'system';
  const effectiveLang = getEffectiveLanguage();
  const currentSize = currentUserPreferences.arabicFontSize ?? 'normal';
  const currentDensity = currentUserPreferences.readingDensity ?? 'comfortable';

  const themeRadio = document.querySelector<HTMLInputElement>(
    `input[name="pref-theme"][value="${currentTheme}"]`,
  );
  if (themeRadio) themeRadio.checked = true;

  const languageRadio = document.querySelector<HTMLInputElement>(
    `input[name="pref-language"][value="${effectiveLang}"]`,
  );
  if (languageRadio) languageRadio.checked = true;

  const sizeRadio = document.querySelector<HTMLInputElement>(
    `input[name="pref-font-size"][value="${currentSize}"]`,
  );
  if (sizeRadio) sizeRadio.checked = true;

  const densityRadio = document.querySelector<HTMLInputElement>(
    `input[name="pref-density"][value="${currentDensity}"]`,
  );
  if (densityRadio) densityRadio.checked = true;

  updateDensityHint();
  renderLayerOrderList();
  updateEditionFilterPillsUI();

  const cachedIds = cachedEditionIdsSet;
  editionsListEl.innerHTML = '';

  const showAll = currentEditionFilter === 'all';

  if (showAll || currentEditionFilter === 'translation') {
    const translations = sortEditionsByInstalledFirst(getAvailableTranslations(), cachedIds);
    if (showAll) {
      const transHeader = document.createElement('h3');
      transHeader.className = 'settings-group-header';
      transHeader.textContent = getMessage('availableTranslations') || 'Translations';
      editionsListEl.appendChild(transHeader);
    }
    for (const edition of translations) {
      editionsListEl.appendChild(createEditionItem(edition, cachedIds));
    }
  }

  if (showAll || currentEditionFilter === 'tafsir') {
    const tafsirs = sortEditionsByInstalledFirst(getAvailableTafsirs(), cachedIds);
    if (showAll) {
      const tafsirHeader = document.createElement('h3');
      tafsirHeader.className = 'settings-group-header';
      tafsirHeader.textContent = getMessage('availableTafsirs') || 'Tafsir (Exegesis)';
      editionsListEl.appendChild(tafsirHeader);
    }
    for (const edition of tafsirs) {
      editionsListEl.appendChild(createEditionItem(edition, cachedIds));
    }
  }

  if (showAll || currentEditionFilter === 'transliteration') {
    const transliterations = sortEditionsByInstalledFirst(
      getAvailableTransliterations(),
      cachedIds,
    );
    if (showAll) {
      const translitHeader = document.createElement('h3');
      translitHeader.className = 'settings-group-header';
      translitHeader.textContent =
        getMessage('availableTransliterations') || 'Phonetic Transliterations';
      editionsListEl.appendChild(translitHeader);
    }
    for (const edition of transliterations) {
      editionsListEl.appendChild(createEditionItem(edition, cachedIds));
    }
  }
}

async function renderSettings(refreshCache = false): Promise<void> {
  if (refreshCache) {
    await refreshCachedEditionIds();
  }
  renderSettingsSync();
}

async function selectTranslation(id: string | null): Promise<void> {
  let nextShowArabic = currentUserPreferences.showArabic ?? true;
  if (!id && !currentUserPreferences.showTransliteration && !nextShowArabic) {
    nextShowArabic = true;
  }

  let nextTranslitId = currentUserPreferences.activeTransliterationId;
  if (id) {
    const selectedEdition = CURATED_EDITIONS.find((e) => e.identifier === id);
    if (selectedEdition) {
      const matchingTranslit = resolveTransliterationForLanguage(selectedEdition.language);
      nextTranslitId = matchingTranslit.identifier;
    }
  }

  currentUserPreferences = {
    ...currentUserPreferences,
    showArabic: nextShowArabic,
    activeTranslationId: id,
    activeTranslationIds: id ? [id] : [],
    activeTransliterationId: nextTranslitId,
  };

  if (id && !activeEditions.has(id)) {
    try {
      const edition = await getCachedEdition(id);
      if (edition) {
        activeEditions.set(id, edition);
      } else {
        const fetched = await fetchAndCacheEdition(id);
        activeEditions.set(id, fetched);
      }
    } catch (err) {
      console.error(`Failed to load translation ${id}:`, err);
    }
  }

  if (currentUserPreferences.showTransliteration && !activeEditions.has(nextTranslitId)) {
    try {
      const translit = await getCachedEdition(nextTranslitId);
      if (translit) {
        activeEditions.set(nextTranslitId, translit);
      }
    } catch (err) {
      console.error(`Failed to load transliteration ${nextTranslitId}:`, err);
    }
  }

  await userPreferencesItem.setValue(currentUserPreferences);
  renderSurahFeed(currentFeedSurah, currentActiveAyahNumber);
  await updateToolbarControls();
  await renderSettings();
}

async function downloadEdition(id: string): Promise<void> {
  downloadingEditions.add(id);
  renderSettingsSync();

  try {
    const edition = await fetchAndCacheEdition(id);
    activeEditions.set(id, edition);
    cachedEditionIdsSet.add(id);

    if (edition.type === 'translation') {
      await selectTranslation(id);
    } else if (edition.type === 'transliteration') {
      currentUserPreferences = {
        ...currentUserPreferences,
        activeTransliterationId: id,
        showTransliteration: true,
      };
      await userPreferencesItem.setValue(currentUserPreferences);
      renderSurahFeed(currentFeedSurah, currentActiveAyahNumber);
      updateToolbarControlsSync();
    } else if (edition.type === 'tafsir') {
      currentUserPreferences = {
        ...currentUserPreferences,
        activeTafsirId: id,
        showTafsir: true,
      };
      await userPreferencesItem.setValue(currentUserPreferences);
      renderSurahFeed(currentFeedSurah, currentActiveAyahNumber);
      updateToolbarControlsSync();
    }
  } catch (err) {
    console.error(`Failed to download edition ${id}:`, err);
  } finally {
    downloadingEditions.delete(id);
    await refreshCachedEditionIds();
    updateToolbarControlsSync();
    renderSettingsSync();
  }
}

async function removeEdition(id: string): Promise<void> {
  try {
    await deleteCachedEdition(id);
    activeEditions.delete(id);
    cachedEditionIdsSet.delete(id);

    let nextShowArabic = currentUserPreferences.showArabic ?? true;
    let nextActiveTransId = currentUserPreferences.activeTranslationId;
    let nextShowTranslit = currentUserPreferences.showTransliteration;
    let nextActiveTranslitId = currentUserPreferences.activeTransliterationId;
    let nextShowTafsir = currentUserPreferences.showTafsir;
    let nextActiveTafsirId = currentUserPreferences.activeTafsirId;

    if (nextActiveTransId === id) {
      nextActiveTransId = null;
    }
    if (nextActiveTranslitId === id) {
      nextShowTranslit = false;
      nextActiveTranslitId = DEFAULT_TRANSLITERATION_ID;
    }
    if (nextActiveTafsirId === id) {
      nextShowTafsir = false;
      nextActiveTafsirId = null;
    }
    if (!nextActiveTransId && !nextShowTranslit && !nextShowArabic) {
      nextShowArabic = true;
    }

    currentUserPreferences = {
      ...currentUserPreferences,
      showArabic: nextShowArabic,
      activeTranslationId: nextActiveTransId,
      activeTranslationIds: nextActiveTransId ? [nextActiveTransId] : [],
      showTransliteration: nextShowTranslit,
      activeTransliterationId: nextActiveTranslitId,
      showTafsir: nextShowTafsir,
      activeTafsirId: nextActiveTafsirId,
    };

    await userPreferencesItem.setValue(currentUserPreferences);
    renderSurahFeed(currentFeedSurah, currentActiveAyahNumber);
    await updateToolbarControls();
    await renderSettings();
  } catch (err) {
    console.error(`Failed to remove edition ${id}:`, err);
  }
}

async function handleTransliterationToggle(enable: boolean): Promise<void> {
  let nextShowArabic = currentUserPreferences.showArabic ?? true;
  if (!enable && !currentUserPreferences.activeTranslationId && !nextShowArabic) {
    nextShowArabic = true;
  }

  let translitId = currentUserPreferences.activeTransliterationId;
  if (enable && currentUserPreferences.activeTranslationId) {
    const activeTransMeta = CURATED_EDITIONS.find(
      (e) => e.identifier === currentUserPreferences.activeTranslationId,
    );
    if (activeTransMeta) {
      const matching = resolveTransliterationForLanguage(activeTransMeta.language);
      const cachedIds = await getCachedEditionIds();
      if (cachedIds.includes(matching.identifier) || !activeEditions.has(translitId)) {
        translitId = matching.identifier;
      }
    }
  }

  currentUserPreferences = {
    ...currentUserPreferences,
    showArabic: nextShowArabic,
    showTransliteration: enable,
    activeTransliterationId: translitId,
  };

  if (enable && !activeEditions.has(translitId)) {
    const cached = await getCachedEdition(translitId);
    if (cached) {
      activeEditions.set(translitId, cached);
    } else {
      downloadingEditions.add(translitId);
      await updateToolbarControls();
      await renderSettings();

      try {
        const downloaded = await fetchAndCacheEdition(translitId);
        activeEditions.set(translitId, downloaded);
      } catch (err) {
        console.error(`Failed to download transliteration edition ${translitId}:`, err);
      } finally {
        downloadingEditions.delete(translitId);
        await updateToolbarControls();
        await renderSettings();
      }
    }
  }

  await userPreferencesItem.setValue(currentUserPreferences);
  renderSurahFeed(currentFeedSurah, currentActiveAyahNumber);
  await updateToolbarControls();
  await renderSettings();
}

async function handleTafsirToggle(enable: boolean, targetTafsirId?: string): Promise<void> {
  const tafsirId = targetTafsirId || currentUserPreferences.activeTafsirId || DEFAULT_TAFSIR_ID;

  currentUserPreferences = {
    ...currentUserPreferences,
    showTafsir: enable,
    activeTafsirId: tafsirId,
  };

  if (enable && !activeEditions.has(tafsirId)) {
    const cached = await getCachedEdition(tafsirId);
    if (cached) {
      activeEditions.set(tafsirId, cached);
    } else {
      downloadingEditions.add(tafsirId);
      await updateToolbarControls();
      await renderSettings();

      try {
        const downloaded = await fetchAndCacheEdition(tafsirId);
        activeEditions.set(tafsirId, downloaded);
      } catch (err) {
        console.error(`Failed to download tafsir edition ${tafsirId}:`, err);
      } finally {
        downloadingEditions.delete(tafsirId);
        await updateToolbarControls();
        await renderSettings();
      }
    }
  }

  await userPreferencesItem.setValue(currentUserPreferences);
  renderSurahFeed(currentFeedSurah, currentActiveAyahNumber);
  await updateToolbarControls();
  await renderSettings();
}

async function onTafsirToggle(): Promise<void> {
  await handleTafsirToggle(!currentUserPreferences.showTafsir);
}

function onSettingsOpen(): void {
  renderSettingsSync();
  void renderSettings(true);
  if (!settingsDialog.open) {
    settingsDialog.showModal();
  }
}

function onSettingsClose(): void {
  settingsDialog.close();
}

function onDialogClick(e: MouseEvent): void {
  if (e.target === settingsDialog) {
    settingsDialog.close();
  }
}

async function onOnline(): Promise<void> {
  activeEditions = await loadActiveEditions(currentUserPreferences);
  renderSurahFeed(currentFeedSurah, currentActiveAyahNumber);
  await updateToolbarControls();
  await renderSettings();
}

function onOffline(): void {
  void renderSettings();
}

async function init(): Promise<void> {
  if (!queryDOMElements()) return;

  localizeUI();

  // Attach event listeners immediately before any asynchronous boundary
  toggleBtn.addEventListener('click', handleToggle);
  toggleArabicBtn.addEventListener('click', onArabicToggle);
  toggleTranslitBtn.addEventListener('click', onTranslitToggle);
  toggleTafsirBtn.addEventListener('click', onTafsirToggle);
  translationSelectEl.addEventListener('change', onTranslationChange);
  followReciterBtn.addEventListener('click', onFollowReciterClick);

  surahPickerTrigger.addEventListener('click', openSurahPicker);
  surahPickerCloseBtn.addEventListener('click', closeSurahPicker);
  surahPickerDialog.addEventListener('click', onSurahPickerBackdropClick);
  surahPickerDialog.addEventListener('close', onSurahPickerClosed);
  surahPickerDialog.addEventListener('keydown', onSurahKeyNavigation);
  surahSearchInput.addEventListener('input', onSurahSearchInput);
  surahPickerList.addEventListener('click', onSurahPickerListClick);
  surahFilterPills.forEach((pill) => {
    pill.addEventListener('click', onFilterPillClick);
  });
  window.addEventListener('keydown', onGlobalKeyDown);

  surahFeedEl.addEventListener('wheel', onUserScrollGesture, { passive: true });
  surahFeedEl.addEventListener('touchstart', onUserScrollGesture, { passive: true });
  surahFeedEl.addEventListener('pointerdown', onUserScrollGesture, { passive: true });
  surahFeedEl.addEventListener('keydown', onUserScrollGesture, { passive: true });

  settingsBtn.addEventListener('click', onSettingsOpen);
  settingsCloseBtn.addEventListener('click', onSettingsClose);
  settingsDialog.addEventListener('click', onDialogClick);
  resetLayerOrderBtn?.addEventListener('click', onResetLayerOrder);
  editionFilterPills.forEach((pill) => {
    pill.addEventListener('click', onEditionFilterPillClick);
  });

  const themeRadios = document.querySelectorAll<HTMLInputElement>('input[name="pref-theme"]');
  themeRadios.forEach((radio) => {
    radio.addEventListener('change', async (e) => {
      const target = e.target as HTMLInputElement;
      if (target.checked) {
        const theme = target.value as AppTheme;
        currentUserPreferences = { ...currentUserPreferences, theme };
        applyAppearancePreferences();
        try {
          localStorage.setItem('theme', theme);
        } catch {}
        await userPreferencesItem.setValue(currentUserPreferences);
      }
    });
  });

  const languageRadios = document.querySelectorAll<HTMLInputElement>('input[name="pref-language"]');
  languageRadios.forEach((radio) => {
    radio.addEventListener('change', async (e) => {
      const target = e.target as HTMLInputElement;
      if (target.checked) {
        const uiLanguage = target.value as UiLanguage;
        currentUserPreferences = { ...currentUserPreferences, uiLanguage };
        try {
          localStorage.setItem('uiLanguage', uiLanguage);
        } catch {}
        withInstantLayoutChange(() => {
          applyAppearancePreferences();
          localizeUI();
          renderSurahFeed(currentFeedSurah, currentActiveAyahNumber);
          updateToolbarControlsSync();
          renderSettingsSync();
        });
        await userPreferencesItem.setValue(currentUserPreferences);
      }
    });
  });

  const fontSizeRadios = document.querySelectorAll<HTMLInputElement>(
    'input[name="pref-font-size"]',
  );
  fontSizeRadios.forEach((radio) => {
    radio.addEventListener('change', async (e) => {
      const target = e.target as HTMLInputElement;
      if (target.checked) {
        const arabicFontSize = target.value as ArabicFontSize;
        currentUserPreferences = { ...currentUserPreferences, arabicFontSize };
        applyAppearancePreferences();
        try {
          localStorage.setItem('arabicFontSize', arabicFontSize);
        } catch {}
        await userPreferencesItem.setValue(currentUserPreferences);
      }
    });
  });

  const densityRadios = document.querySelectorAll<HTMLInputElement>('input[name="pref-density"]');
  densityRadios.forEach((radio) => {
    radio.addEventListener('change', async (e) => {
      const target = e.target as HTMLInputElement;
      if (target.checked) {
        const readingDensity = target.value as ReadingDensity;
        currentUserPreferences = { ...currentUserPreferences, readingDensity };
        applyAppearancePreferences();
        try {
          localStorage.setItem('readingDensity', readingDensity);
        } catch {}
        await userPreferencesItem.setValue(currentUserPreferences);
      }
    });
  });

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('beforeunload', cleanup);

  // Hydrate local corpus and state before listening to external mutations
  await hydrateState();

  unwatchState = captureStateItem.watch((newState: CaptureStateValue | null) => {
    const s = newState ?? CaptureState.IDLE;
    updateUI(s);
  });

  unwatchMatchedAyah = matchedAyahItem.watch((newAyah: MatchedAyah | null) => {
    handleMatch(newAyah);
  });

  unwatchTranscript = transcriptItem.watch((newTranscript: string | null) => {
    handleTranscriptError(newTranscript ?? '');
  });

  unwatchPreferences = userPreferencesItem.watch((prefs: UserEditionPreferences | null) => {
    if (prefs) {
      const incomingTransId =
        prefs.activeTranslationId !== undefined
          ? prefs.activeTranslationId
          : (prefs.activeTranslationIds?.[0] ?? null);
      const currentTransId =
        currentUserPreferences.activeTranslationId !== undefined
          ? currentUserPreferences.activeTranslationId
          : (currentUserPreferences.activeTranslationIds?.[0] ?? null);

      const isArabicSame =
        (prefs.showArabic ?? true) === (currentUserPreferences.showArabic ?? true);
      const isTranslitSame =
        prefs.showTransliteration === currentUserPreferences.showTransliteration;
      const isTranslitIdSame =
        prefs.activeTransliterationId === currentUserPreferences.activeTransliterationId;
      const isTransSame = incomingTransId === currentTransId;
      const isTafsirSame =
        (prefs.showTafsir ?? false) === (currentUserPreferences.showTafsir ?? false);
      const isTafsirIdSame =
        (prefs.activeTafsirId ?? null) === (currentUserPreferences.activeTafsirId ?? null);
      const isLanguageSame =
        (prefs.uiLanguage ?? 'system') === (currentUserPreferences.uiLanguage ?? 'system');
      const isThemeSame = (prefs.theme ?? 'system') === (currentUserPreferences.theme ?? 'system');
      const isFontSizeSame =
        (prefs.arabicFontSize ?? 'normal') === (currentUserPreferences.arabicFontSize ?? 'normal');
      const isDensitySame =
        (prefs.readingDensity ?? 'comfortable') ===
        (currentUserPreferences.readingDensity ?? 'comfortable');
      const incomingOrder = normalizeLayerOrder(prefs.layerOrder);
      const currentOrder = normalizeLayerOrder(currentUserPreferences.layerOrder);
      const isLayerOrderSame = incomingOrder.every((l, i) => l === currentOrder[i]);

      // Skip echo updates already applied locally
      if (
        isArabicSame &&
        isTranslitSame &&
        isTranslitIdSame &&
        isTransSame &&
        isTafsirSame &&
        isTafsirIdSame &&
        isLanguageSame &&
        isThemeSame &&
        isFontSizeSame &&
        isDensitySame &&
        isLayerOrderSame
      ) {
        return;
      }

      currentUserPreferences = {
        ...prefs,
        showArabic: prefs.showArabic ?? true,
        activeTranslationId: incomingTransId,
        layerOrder: incomingOrder,
      };
      applyAppearancePreferences();
      try {
        localStorage.setItem('theme', prefs.theme ?? 'system');
        localStorage.setItem('arabicFontSize', prefs.arabicFontSize ?? 'normal');
        localStorage.setItem('readingDensity', prefs.readingDensity ?? 'comfortable');
        localStorage.setItem('uiLanguage', prefs.uiLanguage ?? 'system');
      } catch {}
      localizeUI();
      loadActiveEditions(currentUserPreferences).then((editions) => {
        activeEditions = editions;
        renderSurahFeed(currentFeedSurah, currentActiveAyahNumber);
        updateToolbarControlsSync();
        renderSettingsSync();
      });
    }
  });
}

function cleanup(): void {
  if (unwatchState) {
    unwatchState();
    unwatchState = undefined;
  }
  if (unwatchMatchedAyah) {
    unwatchMatchedAyah();
    unwatchMatchedAyah = undefined;
  }
  if (unwatchTranscript) {
    unwatchTranscript();
    unwatchTranscript = undefined;
  }
  if (unwatchPreferences) {
    unwatchPreferences();
    unwatchPreferences = undefined;
  }

  toggleBtn?.removeEventListener('click', handleToggle);
  toggleArabicBtn?.removeEventListener('click', onArabicToggle);
  toggleTranslitBtn?.removeEventListener('click', onTranslitToggle);
  toggleTafsirBtn?.removeEventListener('click', onTafsirToggle);
  translationSelectEl?.removeEventListener('change', onTranslationChange);
  followReciterBtn?.removeEventListener('click', onFollowReciterClick);

  surahPickerTrigger?.removeEventListener('click', openSurahPicker);
  surahPickerCloseBtn?.removeEventListener('click', closeSurahPicker);
  surahPickerDialog?.removeEventListener('click', onSurahPickerBackdropClick);
  surahPickerDialog?.removeEventListener('close', onSurahPickerClosed);
  surahPickerDialog?.removeEventListener('keydown', onSurahKeyNavigation);
  surahSearchInput?.removeEventListener('input', onSurahSearchInput);
  surahPickerList?.removeEventListener('click', onSurahPickerListClick);
  surahFilterPills?.forEach((pill) => {
    pill.removeEventListener('click', onFilterPillClick);
  });
  window.removeEventListener('keydown', onGlobalKeyDown);

  surahFeedEl?.removeEventListener('wheel', onUserScrollGesture);
  surahFeedEl?.removeEventListener('touchstart', onUserScrollGesture);
  surahFeedEl?.removeEventListener('pointerdown', onUserScrollGesture);
  surahFeedEl?.removeEventListener('keydown', onUserScrollGesture);

  settingsBtn?.removeEventListener('click', onSettingsOpen);
  settingsCloseBtn?.removeEventListener('click', onSettingsClose);
  settingsDialog?.removeEventListener('click', onDialogClick);
  resetLayerOrderBtn?.removeEventListener('click', onResetLayerOrder);
  editionFilterPills?.forEach((pill) => {
    pill.removeEventListener('click', onEditionFilterPillClick);
  });
  window.removeEventListener('online', onOnline);
  window.removeEventListener('offline', onOffline);
  window.removeEventListener('beforeunload', cleanup);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch(console.error);
  });
} else {
  init().catch(console.error);
}
