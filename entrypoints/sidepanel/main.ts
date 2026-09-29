import {
  CURATED_EDITIONS,
  DEFAULT_TRANSLITERATION_ID,
  deleteCachedEdition,
  type EditionMetadata,
  fetchAndCacheEdition,
  formatEditionAuthors,
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
  CaptureState,
  type CaptureStateValue,
  captureStateItem,
  type MatchedAyah,
  matchedAyahItem,
  transcriptItem,
  type UserEditionPreferences,
  userPreferencesItem,
} from '@/lib/state';

type I18nKey = Parameters<typeof browser.i18n.getMessage>[0];

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
let translationSelectEl: HTMLSelectElement;

let settingsBtn: HTMLButtonElement;
let settingsDialog: HTMLDialogElement;
let settingsCloseBtn: HTMLButtonElement;
let editionsListEl: HTMLElement;

let currentCaptureState: CaptureStateValue = CaptureState.IDLE;
let currentMatchedAyah: MatchedAyah | null = null;
let currentFeedSurah = 1;
let currentActiveAyahNumber: number | null = null;
let isUserFollowing = true;
let isProgrammaticScrolling = false;
let isToggling = false;
let activeTabRequired = false;

let activeEditions = new Map<string, StoredEdition>();
let currentUserPreferences: UserEditionPreferences = {
  showArabic: true,
  activeTranslationId: null,
  activeTranslationIds: [],
  showTransliteration: false,
  activeTransliterationId: DEFAULT_TRANSLITERATION_ID,
};
const downloadingEditions = new Set<string>();

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
  translationSelectEl = tSelect;

  settingsBtn = sBtn;
  settingsDialog = sSettingsDialog;
  settingsCloseBtn = sSettingsCloseBtn;
  editionsListEl = eList;

  return true;
}

function localizeUI(): void {
  const bidiDir = browser.i18n.getMessage('@@bidi_dir');
  if (bidiDir) document.documentElement.dir = bidiDir;
  const uiLocale = browser.i18n.getUILanguage?.();
  if (uiLocale) document.documentElement.lang = uiLocale;

  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n as I18nKey | undefined;
    if (key) el.textContent = browser.i18n.getMessage(key);
  }

  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const key = el.dataset.i18nTitle as I18nKey | undefined;
    if (key) el.title = browser.i18n.getMessage(key);
  }

  for (const el of document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
    const key = el.dataset.i18nPlaceholder as I18nKey | undefined;
    if (key) el.placeholder = browser.i18n.getMessage(key);
  }
}

function updateSurahTrigger(surahNumber: number): void {
  const meta = SURAHS[surahNumber - 1];
  if (!meta) return;
  surahTriggerNumber.textContent = String(meta.number);
  surahTriggerName.textContent = meta.nameEnglish;
  const countMsg = browser.i18n.getMessage('versesCount', [String(meta.totalAyahs)]);
  surahTriggerCount.textContent = countMsg || `${meta.totalAyahs} verses`;
  surahTriggerArabic.textContent = meta.nameArabic;
}

function openSurahPicker(): void {
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
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  });
}

function closeSurahPicker(): void {
  surahPickerTrigger.setAttribute('aria-expanded', 'false');
  if (surahPickerDialog.open) {
    surahPickerDialog.close();
  }
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

function parseAyahJumpQuery(rawQuery: string): { surah: SurahMeta; ayah: number } | null {
  const trimmed = rawQuery.trim();
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
    const filter = pill.dataset.filter as SurahFilterType;
    if (filter === currentSurahFilter) {
      pill.classList.add('surah-filter-pill--active');
    } else {
      pill.classList.remove('surah-filter-pill--active');
    }
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
  const query = rawQuery.trim();
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
    return;
  }

  surahPickerEmpty.hidden = true;
  currentHighlightedIndex = 0;

  const fragment = document.createDocumentFragment();

  for (let idx = 0; idx < currentFilteredItems.length; idx++) {
    const item = currentFilteredItems[idx];
    if (!item) continue;
    const opt = document.createElement('div');
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

      const name = document.createElement('span');
      name.className = 'surah-option__name';
      const jumpMsg = browser.i18n.getMessage('jumpToAyah', [
        item.surah.nameEnglish,
        String(item.ayah),
      ]);
      name.textContent = jumpMsg || `Jump to ${item.surah.nameEnglish}, Ayah ${item.ayah}`;

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

      const lead = document.createElement('div');
      lead.className = 'surah-option__lead';

      const badge = document.createElement('span');
      badge.className = 'surah-option__badge';
      badge.textContent = String(item.surah.number);

      const meta = document.createElement('div');
      meta.className = 'surah-option__meta';

      const name = document.createElement('span');
      name.className = 'surah-option__name';
      name.textContent = item.surah.nameEnglish;

      const sub = document.createElement('div');
      sub.className = 'surah-option__sub';

      const count = document.createElement('span');
      const versesMsg = browser.i18n.getMessage('versesCount', [String(item.surah.totalAyahs)]);
      count.textContent = versesMsg || `${item.surah.totalAyahs} verses`;

      const dot = document.createElement('span');
      dot.textContent = '•';

      const tag = document.createElement('span');
      tag.className = 'surah-option__tag';
      tag.textContent = browser.i18n.getMessage(item.surah.revelation) || item.surah.revelation;

      sub.appendChild(count);
      sub.appendChild(dot);
      sub.appendChild(tag);

      meta.appendChild(name);
      meta.appendChild(sub);
      lead.appendChild(badge);
      lead.appendChild(meta);

      const arabic = document.createElement('span');
      arabic.className = 'surah-option__arabic';
      arabic.textContent = item.surah.nameArabic;

      opt.appendChild(lead);
      opt.appendChild(arabic);
    }

    fragment.appendChild(opt);
  }

  surahPickerList.appendChild(fragment);
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
      renderSurahFeed(surahNumber, targetAyah);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToAyah(targetAyah, false);
        });
      });
    } else {
      isUserFollowing = false;
      renderSurahFeed(surahNumber, ayahNumber);
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
    renderSurahFeed(surahNumber, ayahNumber);
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

function renderSurahFeed(surahNumber: number, activeAyah: number | null): void {
  currentFeedSurah = surahNumber;
  currentActiveAyahNumber = activeAyah;
  updateSurahTrigger(surahNumber);
  surahFeedEl.innerHTML = '';

  const meta = SURAHS[surahNumber - 1];
  if (!meta) return;

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

  const titleEn = document.createElement('span');
  titleEn.textContent = meta.nameEnglish;

  const dot = document.createElement('span');
  dot.textContent = '•';

  const countSpan = document.createElement('span');
  countSpan.textContent = `${meta.totalAyahs} Ayahs`;

  metaRow.appendChild(titleEn);
  metaRow.appendChild(dot);
  metaRow.appendChild(countSpan);

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

  const verses = getSurahVerses(surahNumber);
  const showAr = currentUserPreferences.showArabic ?? true;
  const activeTransId =
    currentUserPreferences.activeTranslationId !== undefined
      ? currentUserPreferences.activeTranslationId
      : (currentUserPreferences.activeTranslationIds?.[0] ?? null);

  for (let i = 0; i < verses.length; i++) {
    const ayah = verses[i] as CorpusAyah;
    const isActive = activeAyah === ayah.ayah;

    const card = document.createElement('article');
    card.id = `ayah-${ayah.ayah}`;
    card.dataset.ayah = String(ayah.ayah);
    card.className = isActive ? 'ayah-card ayah-card--active' : 'ayah-card ayah-card--context';

    const cardHeader = document.createElement('header');
    cardHeader.className = 'ayah-card__header';

    const surahInfo = document.createElement('div');
    surahInfo.className = 'ayah-card__surah-info';

    const surahArSpan = document.createElement('span');
    surahArSpan.className = 'ayah-card__surah-arabic';
    surahArSpan.setAttribute('dir', 'rtl');
    surahArSpan.setAttribute('lang', 'ar');
    surahArSpan.textContent = `سورة ${ayah.surahNameArabic}`;

    const surahEnSpan = document.createElement('span');
    surahEnSpan.className = 'ayah-card__surah-english';
    surahEnSpan.textContent = `${ayah.surahNameEnglish} ${ayah.surah}:${ayah.ayah}`;

    surahInfo.appendChild(surahArSpan);
    surahInfo.appendChild(surahEnSpan);

    const badges = document.createElement('div');
    badges.className = 'ayah-card__badges';

    if (ayah.isSajdah) {
      const sajdahBadge = document.createElement('span');
      sajdahBadge.className = 'ayah-card__sajdah-badge';
      const sajdahBdi = document.createElement('bdi');
      const sajdahText = browser.i18n.getMessage('sajdahBadge') || 'Sajdah';
      sajdahBdi.textContent = `۩ ${sajdahText}`;
      sajdahBadge.appendChild(sajdahBdi);
      badges.appendChild(sajdahBadge);
    }

    const ayahBadge = document.createElement('div');
    ayahBadge.className = 'ayah-card__badge';
    ayahBadge.setAttribute('dir', 'ltr');
    const badgeBdi = document.createElement('bdi');
    badgeBdi.setAttribute('dir', 'ltr');
    badgeBdi.textContent = `${ayah.surah}:${ayah.ayah} (${ayah.ayah}/${ayah.totalAyahs})`;
    ayahBadge.appendChild(badgeBdi);
    badges.appendChild(ayahBadge);

    cardHeader.appendChild(surahInfo);
    cardHeader.appendChild(badges);
    card.appendChild(cardHeader);

    const body = document.createElement('div');
    body.className = 'ayah-card__body';

    let hasPrecedingContent = showAr;

    if (showAr) {
      const p = document.createElement('p');
      p.className = 'ayah-card__text';
      p.setAttribute('dir', 'rtl');
      p.setAttribute('lang', 'ar');
      p.textContent = `${ayah.uthmani}\u00A0${ayah.ayahMarker}`.trim();
      body.appendChild(p);
    }

    if (
      currentUserPreferences.showTransliteration &&
      currentUserPreferences.activeTransliterationId
    ) {
      const translitEdition = activeEditions.get(currentUserPreferences.activeTransliterationId);
      const text = translitEdition?.ayahs[ayah.index];
      if (text) {
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
      }
    }

    if (activeTransId) {
      const edition = activeEditions.get(activeTransId);
      if (edition) {
        const text = edition.ayahs[ayah.index];
        if (text) {
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
        }
      }
    }

    card.appendChild(body);
    fragment.appendChild(card);
  }

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
    block: 'center',
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
  const followMsg = browser.i18n.getMessage('followReciter') || 'Follow Reciter';
  const meta = SURAHS[currentMatchedAyah.surah - 1];
  const surahName = meta?.nameEnglish ?? `Surah ${currentMatchedAyah.surah}`;
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
      renderSurahFeed(ayah.surah, ayah.ayah);
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
      renderSurahFeed(currentFeedSurah, targetAyah);
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
    };
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

  await updateToolbarControls();

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
  const isTransitioning = state === CaptureState.STARTING || state === CaptureState.STOPPING;

  if (isCapturing) {
    activeTabRequired = false;
    idleHint.hidden = true;
    toggleBtn.hidden = false;
    toggleBtn.disabled = isToggling;
    toggleBtn.className = 'btn btn--danger';
    toggleBtn.textContent = browser.i18n.getMessage('stopCapture');
    toggleBtn.setAttribute('aria-busy', 'false');
    listeningIndicator.hidden = currentMatchedAyah !== null;
  } else if (isTransitioning) {
    idleHint.hidden = true;
    toggleBtn.hidden = false;
    toggleBtn.disabled = true;
    toggleBtn.setAttribute('aria-busy', 'true');
    listeningIndicator.hidden = false;
  } else {
    toggleBtn.setAttribute('aria-busy', 'false');
    listeningIndicator.hidden = true;
    followReciterBtn.hidden = true;
    toggleBtn.hidden = false;
    toggleBtn.disabled = isToggling;
    toggleBtn.className = 'btn btn--primary';
    toggleBtn.textContent = browser.i18n.getMessage('startCapture');

    if (activeTabRequired) {
      idleHint.hidden = false;
    } else {
      idleHint.hidden = true;
    }
  }

  statusEl.textContent = browser.i18n.getMessage(isCapturing ? 'statusCapturing' : 'statusIdle');
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

async function populateTranslationSelect(): Promise<void> {
  const cachedIds = new Set(await getCachedEditionIds());
  const activeTransId =
    currentUserPreferences.activeTranslationId !== undefined
      ? currentUserPreferences.activeTranslationId
      : (currentUserPreferences.activeTranslationIds?.[0] ?? null);

  translationSelectEl.innerHTML = '';

  const noTransOpt = document.createElement('option');
  noTransOpt.value = 'none';
  noTransOpt.textContent = browser.i18n.getMessage('noTranslation') || 'No Translation';
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
  downloadMoreOpt.textContent =
    browser.i18n.getMessage('downloadMore') || '+ Download Languages...';
  translationSelectEl.appendChild(downloadMoreOpt);

  if (activeTransId && cachedIds.has(activeTransId)) {
    translationSelectEl.value = activeTransId;
  } else {
    translationSelectEl.value = 'none';
  }
}

async function updateToolbarControls(): Promise<void> {
  const showArabic = currentUserPreferences.showArabic ?? true;
  toggleArabicBtn.className = showArabic ? 'pill-btn pill-btn--active' : 'pill-btn';
  toggleArabicBtn.setAttribute('aria-pressed', showArabic ? 'true' : 'false');

  const translitId = currentUserPreferences.activeTransliterationId;
  const isDownloadingTranslit = downloadingEditions.has(translitId);
  const showTranslit = currentUserPreferences.showTransliteration;

  if (isDownloadingTranslit) {
    toggleTranslitBtn.className = 'pill-btn pill-btn--loading';
  } else {
    toggleTranslitBtn.className = showTranslit ? 'pill-btn pill-btn--active' : 'pill-btn';
  }
  toggleTranslitBtn.setAttribute('aria-pressed', showTranslit ? 'true' : 'false');

  await populateTranslationSelect();
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

  await userPreferencesItem.setValue(currentUserPreferences);
  await updateToolbarControls();
  renderSurahFeed(currentFeedSurah, currentActiveAyahNumber);
}

async function onTranslitToggle(): Promise<void> {
  await handleTransliterationToggle(!currentUserPreferences.showTransliteration);
}

async function onTranslationChange(): Promise<void> {
  const value = translationSelectEl.value;
  if (value === '__settings__') {
    translationSelectEl.value = currentUserPreferences.activeTranslationId ?? 'none';
    onSettingsOpen();
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
      : currentUserPreferences.showTransliteration &&
        currentUserPreferences.activeTransliterationId === edition.identifier;

  const item = document.createElement('div');
  item.className = isActive ? 'edition-item edition-item--active' : 'edition-item';

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
    badge.textContent = browser.i18n.getMessage('downloading') || 'Downloading...';
    action.appendChild(badge);
  } else if (isCached) {
    const badge = document.createElement('span');
    badge.className = 'badge badge--downloaded';
    badge.textContent = `✓ ${browser.i18n.getMessage('downloaded') || 'Downloaded'}`;
    action.appendChild(badge);

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn-remove';
    btnRemove.textContent = browser.i18n.getMessage('remove') || 'Remove';
    btnRemove.setAttribute(
      'aria-label',
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
      offlineNotice.textContent =
        browser.i18n.getMessage('offlineNotice') || 'Offline - connect to download';
      action.appendChild(offlineNotice);
    } else {
      const btnDownload = document.createElement('button');
      btnDownload.type = 'button';
      btnDownload.className = 'btn-download';
      const dlText = browser.i18n.getMessage('download') || 'Download';
      const sizeText = browser.i18n.getMessage('approxSize') || '~1.2 MB';
      btnDownload.textContent = `${dlText} (${sizeText})`;
      btnDownload.setAttribute(
        'aria-label',
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
  langTag.textContent =
    edition.type === 'transliteration'
      ? `Aa · ${edition.language.toUpperCase()}`
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
        await selectTranslation(edition.identifier);
      } else if (edition.type === 'transliteration') {
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
    });
  }

  item.appendChild(header);
  item.appendChild(sub);
  return item;
}

async function renderSettings(): Promise<void> {
  const cachedIds = new Set(await getCachedEditionIds());
  editionsListEl.innerHTML = '';

  const translations = getAvailableTranslations();
  const transliterations = getAvailableTransliterations();

  const transHeader = document.createElement('h3');
  transHeader.className = 'settings-group-header';
  transHeader.textContent = browser.i18n.getMessage('availableTranslations') || 'Translations';
  editionsListEl.appendChild(transHeader);

  for (const edition of translations) {
    editionsListEl.appendChild(createEditionItem(edition, cachedIds));
  }

  const translitHeader = document.createElement('h3');
  translitHeader.className = 'settings-group-header';
  translitHeader.textContent =
    browser.i18n.getMessage('availableTransliterations') || 'Phonetic Transliterations';
  editionsListEl.appendChild(translitHeader);

  for (const edition of transliterations) {
    editionsListEl.appendChild(createEditionItem(edition, cachedIds));
  }
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
  await renderSettings();

  try {
    const edition = await fetchAndCacheEdition(id);
    activeEditions.set(id, edition);

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
      await updateToolbarControls();
    }
  } catch (err) {
    console.error(`Failed to download edition ${id}:`, err);
  } finally {
    downloadingEditions.delete(id);
    await updateToolbarControls();
    await renderSettings();
  }
}

async function removeEdition(id: string): Promise<void> {
  try {
    await deleteCachedEdition(id);
    activeEditions.delete(id);

    let nextShowArabic = currentUserPreferences.showArabic ?? true;
    let nextActiveTransId = currentUserPreferences.activeTranslationId;
    let nextShowTranslit = currentUserPreferences.showTransliteration;
    let nextActiveTranslitId = currentUserPreferences.activeTransliterationId;

    if (nextActiveTransId === id) {
      nextActiveTransId = null;
    }
    if (nextActiveTranslitId === id) {
      nextShowTranslit = false;
      nextActiveTranslitId = DEFAULT_TRANSLITERATION_ID;
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

function onSettingsOpen(): void {
  void renderSettings();
  settingsDialog.showModal();
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

async function init(): Promise<void> {
  if (!queryDOMElements()) return;

  localizeUI();

  // Attach event listeners immediately before any asynchronous boundary
  toggleBtn.addEventListener('click', handleToggle);
  toggleArabicBtn.addEventListener('click', onArabicToggle);
  toggleTranslitBtn.addEventListener('click', onTranslitToggle);
  translationSelectEl.addEventListener('change', onTranslationChange);
  followReciterBtn.addEventListener('click', onFollowReciterClick);

  surahPickerTrigger.addEventListener('click', openSurahPicker);
  surahPickerCloseBtn.addEventListener('click', closeSurahPicker);
  surahPickerDialog.addEventListener('click', onSurahPickerBackdropClick);
  surahSearchInput.addEventListener('input', onSurahSearchInput);
  surahSearchInput.addEventListener('keydown', onSurahKeyNavigation);
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
  window.addEventListener('online', onOnline);
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
      currentUserPreferences = {
        ...prefs,
        showArabic: prefs.showArabic ?? true,
        activeTranslationId:
          prefs.activeTranslationId !== undefined
            ? prefs.activeTranslationId
            : (prefs.activeTranslationIds?.[0] ?? null),
      };
      loadActiveEditions(currentUserPreferences).then((editions) => {
        activeEditions = editions;
        renderSurahFeed(currentFeedSurah, currentActiveAyahNumber);
        void updateToolbarControls();
        void renderSettings();
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
  translationSelectEl?.removeEventListener('change', onTranslationChange);
  followReciterBtn?.removeEventListener('click', onFollowReciterClick);

  surahPickerTrigger?.removeEventListener('click', openSurahPicker);
  surahPickerCloseBtn?.removeEventListener('click', closeSurahPicker);
  surahPickerDialog?.removeEventListener('click', onSurahPickerBackdropClick);
  surahSearchInput?.removeEventListener('input', onSurahSearchInput);
  surahSearchInput?.removeEventListener('keydown', onSurahKeyNavigation);
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
  window.removeEventListener('online', onOnline);
  window.removeEventListener('beforeunload', cleanup);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch(console.error);
  });
} else {
  init().catch(console.error);
}
