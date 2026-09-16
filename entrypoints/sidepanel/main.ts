import {
  CURATED_EDITIONS,
  fetchAndCacheEdition,
  getCachedEdition,
  getCachedEditionIds,
  loadActiveEditions,
  type StoredEdition,
} from '@/lib/editions';
import { type CaptureResponseMessage, MSG } from '@/lib/messages';
import { isSajdah } from '@/lib/quran-meta';
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
let placeholderView: HTMLElement;
let placeholderText: HTMLElement;
let listeningIndicator: HTMLElement;
let ayahCard: HTMLElement;
let surahArabicEl: HTMLElement;
let surahEnglishEl: HTMLElement;
let ayahBadgeEl: HTMLElement;
let sajdahBadgeEl: HTMLElement;
let ayahTextEl: HTMLElement;
let transliterationContainerEl: HTMLElement;
let transliterationTextEl: HTMLElement;
let translationsContainerEl: HTMLElement;
let liveSpeechStrip: HTMLElement;
let liveSpeechTextEl: HTMLElement;

let settingsBtn: HTMLButtonElement;
let settingsDialog: HTMLDialogElement;
let settingsCloseBtn: HTMLButtonElement;
let toggleTransliterationInput: HTMLInputElement;
let editionsListEl: HTMLElement;
let transliterationStatusEl: HTMLElement | null = null;

let currentCaptureState: CaptureStateValue = CaptureState.IDLE;
let currentMatchedAyah: MatchedAyah | null = null;
let renderedAyahKey = '';
let currentTranscript = '';
let isToggling = false;
let activeTabRequired = false;

let activeEditions = new Map<string, StoredEdition>();
let currentUserPreferences: UserEditionPreferences = {
  activeTranslationId: null,
  activeTranslationIds: [],
  showTransliteration: false,
  activeTransliterationId: 'en.transliteration',
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
  const placeholder = document.getElementById('placeholder-view');
  const text = document.getElementById('placeholder-text');
  const indicator = document.getElementById('listening-indicator');
  const card = document.getElementById('ayah-card');
  const surahAr = document.getElementById('surah-arabic');
  const surahEn = document.getElementById('surah-english');
  const badge = document.getElementById('ayah-badge');
  const sajdah = document.getElementById('sajdah-badge');
  const ayahTxt = document.getElementById('ayah-text');
  const translitCont = document.getElementById('transliteration-container');
  const translitTxt = document.getElementById('transliteration-text');
  const translationsCont = document.getElementById('translations-container');
  const liveStrip = document.getElementById('live-speech-strip');
  const liveText = document.getElementById('live-speech-text');

  const sBtn = document.getElementById('settings-btn') as HTMLButtonElement | null;
  const sDialog = document.getElementById('settings-dialog') as HTMLDialogElement | null;
  const sCloseBtn = document.getElementById('settings-close-btn') as HTMLButtonElement | null;
  const tTranslit = document.getElementById('toggle-transliteration') as HTMLInputElement | null;
  const eList = document.getElementById('editions-list');

  if (
    !btn ||
    !hint ||
    !status ||
    !error ||
    !placeholder ||
    !text ||
    !indicator ||
    !card ||
    !surahAr ||
    !surahEn ||
    !badge ||
    !sajdah ||
    !ayahTxt ||
    !translitCont ||
    !translitTxt ||
    !translationsCont ||
    !liveStrip ||
    !liveText ||
    !sBtn ||
    !sDialog ||
    !sCloseBtn ||
    !tTranslit ||
    !eList
  ) {
    console.error('Missing required side panel DOM elements');
    return false;
  }

  toggleBtn = btn;
  idleHint = hint;
  statusEl = status;
  errorBanner = error;
  placeholderView = placeholder;
  placeholderText = text;
  listeningIndicator = indicator;
  ayahCard = card;
  surahArabicEl = surahAr;
  surahEnglishEl = surahEn;
  ayahBadgeEl = badge;
  sajdahBadgeEl = sajdah;
  ayahTextEl = ayahTxt;
  transliterationContainerEl = translitCont;
  transliterationTextEl = translitTxt;
  translationsContainerEl = translationsCont;
  liveSpeechStrip = liveStrip;
  liveSpeechTextEl = liveText;

  settingsBtn = sBtn;
  settingsDialog = sDialog;
  settingsCloseBtn = sCloseBtn;
  toggleTransliterationInput = tTranslit;
  editionsListEl = eList;
  transliterationStatusEl = document.getElementById('transliteration-status');

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

  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
    const key = el.dataset.i18nPlaceholder as I18nKey | undefined;
    if (key) el.dataset.placeholder = browser.i18n.getMessage(key);
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
  currentTranscript = transcript ?? '';
  currentMatchedAyah = matchedAyah ?? null;
  if (prefs) {
    currentUserPreferences = {
      ...prefs,
      activeTranslationId:
        prefs.activeTranslationId !== undefined
          ? prefs.activeTranslationId
          : (prefs.activeTranslationIds?.[0] ?? null),
    };
  }

  updateUI(state);
  renderAyah(currentMatchedAyah);
  renderTranscript(currentTranscript);

  activeEditions = await loadActiveEditions(currentUserPreferences);
  renderAyah(currentMatchedAyah);
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
      const response = (await browser.runtime.sendMessage({
        type: MSG.STOP_CAPTURE,
      })) as CaptureResponseMessage | undefined;

      if (response?.type === MSG.ERROR) {
        console.error('Background returned error stopping capture:', response.payload);
      }
    } else if (state === CaptureState.IDLE) {
      const response = (await browser.runtime.sendMessage({
        type: MSG.START_CAPTURE,
      })) as CaptureResponseMessage | undefined;

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
      }
    }
  } catch (err) {
    console.error('Error toggling capture:', err);
  } finally {
    isToggling = false;
    await hydrateState();
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
  } else if (isTransitioning) {
    idleHint.hidden = true;
    toggleBtn.hidden = false;
    toggleBtn.disabled = true;
    toggleBtn.setAttribute('aria-busy', 'true');
  } else {
    toggleBtn.setAttribute('aria-busy', 'false');
    if (activeTabRequired) {
      idleHint.hidden = false;
      toggleBtn.hidden = true;
    } else {
      idleHint.hidden = true;
      toggleBtn.hidden = false;
      toggleBtn.disabled = isToggling;
      toggleBtn.className = 'btn btn--primary';
      toggleBtn.textContent = browser.i18n.getMessage('startCapture');
    }
  }

  statusEl.textContent = browser.i18n.getMessage(isCapturing ? 'statusCapturing' : 'statusIdle');
  statusEl.className = `status status--${state}`;
}

function renderAyah(ayah: MatchedAyah | null): void {
  currentMatchedAyah = ayah;
  const isCardVisible = Boolean(ayah && currentCaptureState === CaptureState.CAPTURING);

  if (isCardVisible && ayah) {
    if (placeholderView.hidden !== true) placeholderView.hidden = true;
    if (ayahCard.hidden !== false) ayahCard.hidden = false;

    const activeTransId =
      currentUserPreferences.activeTranslationId !== undefined
        ? currentUserPreferences.activeTranslationId
        : (currentUserPreferences.activeTranslationIds?.[0] ?? null);

    const newKey = `${ayah.surah}:${ayah.ayah}:${ayah.index}:${currentUserPreferences.showTransliteration}:${currentUserPreferences.activeTransliterationId}:${activeTransId ?? 'none'}`;
    if (renderedAyahKey !== newKey) {
      renderedAyahKey = newKey;

      surahArabicEl.textContent = ayah.surahNameArabic
        ? `سورة ${ayah.surahNameArabic}`
        : `سورة ${ayah.surah}`;
      surahEnglishEl.textContent = ayah.surahNameEnglish ?? '';

      ayahBadgeEl.textContent = ayah.totalAyahs
        ? `${ayah.surah}:${ayah.ayah} (${ayah.ayah}/${ayah.totalAyahs})`
        : `${ayah.surah}:${ayah.ayah}`;

      const isSajdahVerse = Boolean(ayah.isSajdah ?? isSajdah(ayah.surah, ayah.ayah));
      sajdahBadgeEl.hidden = !isSajdahVerse;

      const marker = ayah.ayahMarker ? `\u00A0${ayah.ayahMarker}` : '';
      ayahTextEl.textContent = `${ayah.uthmani}${marker}`.trim();

      if (
        currentUserPreferences.showTransliteration &&
        currentUserPreferences.activeTransliterationId
      ) {
        const translitEdition = activeEditions.get(currentUserPreferences.activeTransliterationId);
        const text = translitEdition?.ayahs[ayah.index];
        if (text) {
          transliterationTextEl.textContent = text;
          transliterationContainerEl.hidden = false;
        } else {
          transliterationContainerEl.hidden = true;
        }
      } else {
        transliterationContainerEl.hidden = true;
      }

      translationsContainerEl.innerHTML = '';
      if (activeTransId) {
        const edition = activeEditions.get(activeTransId);
        if (edition) {
          const text = edition.ayahs[ayah.index];
          if (text) {
            const block = document.createElement('div');
            block.className = 'ayah-translation-block';
            block.setAttribute('dir', edition.direction);

            const label = document.createElement('span');
            label.className = 'ayah-translation-label';

            const bdi = document.createElement('bdi');
            bdi.textContent = edition.englishName || edition.name;
            label.appendChild(bdi);

            const p = document.createElement('p');
            p.className = 'ayah-translation-text';
            p.textContent = text;

            block.appendChild(label);
            block.appendChild(p);
            translationsContainerEl.appendChild(block);
          }
        }
      }
    }
  } else {
    renderedAyahKey = '';
    if (ayahCard.hidden !== true) ayahCard.hidden = true;
    if (placeholderView.hidden !== false) placeholderView.hidden = false;

    const isListening =
      currentCaptureState === CaptureState.CAPTURING ||
      currentCaptureState === CaptureState.STARTING;
    const msgKey: I18nKey = isListening ? 'listeningForRecitation' : 'readyToListen';
    const nextText = browser.i18n.getMessage(msgKey);

    if (placeholderText.textContent !== nextText) {
      placeholderText.textContent = nextText;
    }
    if (listeningIndicator.hidden !== !isListening) {
      listeningIndicator.hidden = !isListening;
    }
  }
}

function renderTranscript(text: string): void {
  currentTranscript = text;

  if (text.startsWith('Error:')) {
    if (errorBanner.textContent !== text) {
      errorBanner.textContent = text;
    }
    if (errorBanner.hidden !== false) errorBanner.hidden = false;
    if (liveSpeechStrip.hidden !== true) liveSpeechStrip.hidden = true;
  } else {
    if (errorBanner.hidden !== true) errorBanner.hidden = true;

    if (text.trim() && currentCaptureState === CaptureState.CAPTURING) {
      if (liveSpeechStrip.hidden !== false) liveSpeechStrip.hidden = false;
      if (liveSpeechTextEl.textContent !== text) {
        liveSpeechTextEl.textContent = text;
      }
    } else {
      if (liveSpeechStrip.hidden !== true) liveSpeechStrip.hidden = true;
    }
  }
}

async function renderSettings(): Promise<void> {
  toggleTransliterationInput.checked = currentUserPreferences.showTransliteration;

  const cachedIds = new Set(await getCachedEditionIds());

  if (transliterationStatusEl) {
    const translitId = currentUserPreferences.activeTransliterationId;
    if (downloadingEditions.has(translitId)) {
      transliterationStatusEl.className = 'badge badge--downloading';
      transliterationStatusEl.textContent =
        browser.i18n.getMessage('downloading') || 'Downloading...';
      transliterationStatusEl.hidden = false;
    } else if (cachedIds.has(translitId)) {
      transliterationStatusEl.className = 'badge badge--downloaded';
      transliterationStatusEl.textContent = `✓ ${browser.i18n.getMessage('downloaded') || 'Downloaded'}`;
      transliterationStatusEl.hidden = false;
    } else {
      transliterationStatusEl.className = 'badge badge--info';
      transliterationStatusEl.textContent = browser.i18n.getMessage('approxSize') || '~1.2 MB';
      transliterationStatusEl.hidden = false;
    }
  }

  const activeTransId =
    currentUserPreferences.activeTranslationId !== undefined
      ? currentUserPreferences.activeTranslationId
      : (currentUserPreferences.activeTranslationIds?.[0] ?? null);

  editionsListEl.innerHTML = '';

  const isArabicOnly = !activeTransId;
  const arabicOnlyItem = document.createElement('div');
  arabicOnlyItem.className = `edition-item ${isArabicOnly ? 'edition-item--active' : ''}`;

  const arabicInfo = document.createElement('div');
  arabicInfo.className = 'edition-item__info';

  const arabicName = document.createElement('span');
  arabicName.className = 'edition-item__name';
  arabicName.textContent = browser.i18n.getMessage('arabicOnly') || 'Arabic Only (No Translation)';

  const arabicSub = document.createElement('span');
  arabicSub.className = 'edition-item__sub';
  arabicSub.textContent =
    browser.i18n.getMessage('arabicOnlyDesc') || 'Display original Quranic recitation only';

  arabicInfo.appendChild(arabicName);
  arabicInfo.appendChild(arabicSub);

  const arabicAction = document.createElement('div');
  arabicAction.className = 'edition-item__action';

  const arabicRadio = document.createElement('input');
  arabicRadio.type = 'radio';
  arabicRadio.name = 'quran-translation-selection';
  arabicRadio.value = 'none';
  arabicRadio.checked = isArabicOnly;
  arabicRadio.setAttribute('aria-label', arabicName.textContent);

  arabicRadio.addEventListener('change', async () => {
    if (arabicRadio.checked) {
      await selectTranslation(null);
    }
  });

  arabicOnlyItem.addEventListener('click', async (e) => {
    if ((e.target as HTMLElement).tagName.toLowerCase() === 'input') return;
    await selectTranslation(null);
  });

  arabicAction.appendChild(arabicRadio);
  arabicOnlyItem.appendChild(arabicInfo);
  arabicOnlyItem.appendChild(arabicAction);
  editionsListEl.appendChild(arabicOnlyItem);

  const translationEditions = CURATED_EDITIONS.filter((e) => e.type === 'translation');

  for (const edition of translationEditions) {
    const isSelected = activeTransId === edition.identifier;
    const isDownloading = downloadingEditions.has(edition.identifier);
    const isCached = cachedIds.has(edition.identifier);

    const item = document.createElement('div');
    item.className = `edition-item ${isSelected ? 'edition-item--active' : ''}`;

    const info = document.createElement('div');
    info.className = 'edition-item__info';

    const name = document.createElement('span');
    name.className = 'edition-item__name';
    name.textContent = edition.englishName;

    const sub = document.createElement('span');
    sub.className = 'edition-item__sub';

    const langTag = document.createElement('span');
    langTag.className = 'edition-item__lang-tag';
    langTag.textContent = edition.language.toUpperCase();

    const authorText = document.createTextNode(edition.name);

    sub.appendChild(langTag);
    sub.appendChild(authorText);

    info.appendChild(name);
    info.appendChild(sub);

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

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'quran-translation-selection';
      radio.value = edition.identifier;
      radio.checked = isSelected;
      radio.setAttribute(
        'aria-label',
        `Select ${edition.englishName} (${edition.language}) translation`,
      );

      radio.addEventListener('change', async () => {
        if (radio.checked) {
          await selectTranslation(edition.identifier);
        }
      });

      action.appendChild(radio);

      item.addEventListener('click', async (e) => {
        if ((e.target as HTMLElement).tagName.toLowerCase() === 'input') return;
        await selectTranslation(edition.identifier);
      });
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
          `Download and select ${edition.englishName} (${edition.language}) translation`,
        );

        btnDownload.addEventListener('click', async (e) => {
          e.stopPropagation();
          await downloadAndSelectTranslation(edition.identifier);
        });

        action.appendChild(btnDownload);
      }
    }

    item.appendChild(info);
    item.appendChild(action);
    editionsListEl.appendChild(item);
  }
}

async function selectTranslation(id: string | null): Promise<void> {
  currentUserPreferences = {
    ...currentUserPreferences,
    activeTranslationId: id,
    activeTranslationIds: id ? [id] : [],
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

  await userPreferencesItem.setValue(currentUserPreferences);
  renderedAyahKey = '';
  renderAyah(currentMatchedAyah);
  await renderSettings();
}

async function downloadAndSelectTranslation(id: string): Promise<void> {
  downloadingEditions.add(id);
  await renderSettings();

  try {
    const downloaded = await fetchAndCacheEdition(id);
    activeEditions.set(id, downloaded);
    await selectTranslation(id);
  } catch (err) {
    console.error(`Failed to download edition ${id}:`, err);
  } finally {
    downloadingEditions.delete(id);
    await renderSettings();
  }
}

async function handleTransliterationToggle(enable: boolean): Promise<void> {
  currentUserPreferences = {
    ...currentUserPreferences,
    showTransliteration: enable,
  };

  const translitId = currentUserPreferences.activeTransliterationId;
  if (enable && !activeEditions.has(translitId)) {
    downloadingEditions.add(translitId);
    await renderSettings();

    try {
      const downloaded = await fetchAndCacheEdition(translitId);
      activeEditions.set(translitId, downloaded);
    } catch (err) {
      console.error('Failed to download transliteration edition:', err);
    } finally {
      downloadingEditions.delete(translitId);
      await renderSettings();
    }
  }

  await userPreferencesItem.setValue(currentUserPreferences);
  renderedAyahKey = '';
  renderAyah(currentMatchedAyah);
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

async function onTransliterationChange(): Promise<void> {
  await handleTransliterationToggle(toggleTransliterationInput.checked);
}

async function onOnline(): Promise<void> {
  activeEditions = await loadActiveEditions(currentUserPreferences);
  renderAyah(currentMatchedAyah);
  await renderSettings();
}

async function init(): Promise<void> {
  if (!queryDOMElements()) return;

  localizeUI();

  // Attach event listeners immediately before any asynchronous boundary
  toggleBtn.addEventListener('click', handleToggle);
  settingsBtn.addEventListener('click', onSettingsOpen);
  settingsCloseBtn.addEventListener('click', onSettingsClose);
  settingsDialog.addEventListener('click', onDialogClick);
  toggleTransliterationInput.addEventListener('change', onTransliterationChange);
  window.addEventListener('online', onOnline);
  window.addEventListener('beforeunload', cleanup);

  unwatchState = captureStateItem.watch((newState: CaptureStateValue | null) => {
    const s = newState ?? CaptureState.IDLE;
    updateUI(s);
    renderAyah(currentMatchedAyah);
    renderTranscript(currentTranscript);
  });

  unwatchMatchedAyah = matchedAyahItem.watch((newAyah: MatchedAyah | null) => {
    renderAyah(newAyah);
  });

  unwatchTranscript = transcriptItem.watch((newTranscript: string | null) => {
    renderTranscript(newTranscript ?? '');
  });

  unwatchPreferences = userPreferencesItem.watch((prefs: UserEditionPreferences | null) => {
    if (prefs) {
      currentUserPreferences = {
        ...prefs,
        activeTranslationId:
          prefs.activeTranslationId !== undefined
            ? prefs.activeTranslationId
            : (prefs.activeTranslationIds?.[0] ?? null),
      };
      loadActiveEditions(currentUserPreferences).then((editions) => {
        activeEditions = editions;
        renderAyah(currentMatchedAyah);
        void renderSettings();
      });
    }
  });

  await hydrateState();
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
  settingsBtn?.removeEventListener('click', onSettingsOpen);
  settingsCloseBtn?.removeEventListener('click', onSettingsClose);
  settingsDialog?.removeEventListener('click', onDialogClick);
  toggleTransliterationInput?.removeEventListener('change', onTransliterationChange);
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
