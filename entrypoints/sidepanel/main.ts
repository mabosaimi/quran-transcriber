import {
  CURATED_EDITIONS,
  deleteCachedEdition,
  fetchAndCacheEdition,
  getCachedEdition,
  getCachedEditionIds,
  getLanguageEndonym,
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

let toggleArabicBtn: HTMLButtonElement;
let toggleTranslitBtn: HTMLButtonElement;
let translationSelectEl: HTMLSelectElement;

let settingsBtn: HTMLButtonElement;
let settingsDialog: HTMLDialogElement;
let settingsCloseBtn: HTMLButtonElement;
let editionsListEl: HTMLElement;

let currentCaptureState: CaptureStateValue = CaptureState.IDLE;
let currentMatchedAyah: MatchedAyah | null = null;
let renderedAyahKey = '';
let currentTranscript = '';
let isToggling = false;
let activeTabRequired = false;

let activeEditions = new Map<string, StoredEdition>();
let currentUserPreferences: UserEditionPreferences = {
  showArabic: true,
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

  const tArabicBtn = document.getElementById('toggle-arabic-btn') as HTMLButtonElement | null;
  const tTranslitBtn = document.getElementById('toggle-translit-btn') as HTMLButtonElement | null;
  const tSelect = document.getElementById('translation-select') as HTMLSelectElement | null;

  const sBtn = document.getElementById('settings-btn') as HTMLButtonElement | null;
  const sDialog = document.getElementById('settings-dialog') as HTMLDialogElement | null;
  const sCloseBtn = document.getElementById('settings-close-btn') as HTMLButtonElement | null;
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
    !tArabicBtn ||
    !tTranslitBtn ||
    !tSelect ||
    !sBtn ||
    !sDialog ||
    !sCloseBtn ||
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

  toggleArabicBtn = tArabicBtn;
  toggleTranslitBtn = tTranslitBtn;
  translationSelectEl = tSelect;

  settingsBtn = sBtn;
  settingsDialog = sDialog;
  settingsCloseBtn = sCloseBtn;
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
      showArabic: prefs.showArabic ?? true,
      activeTranslationId:
        prefs.activeTranslationId !== undefined
          ? prefs.activeTranslationId
          : (prefs.activeTranslationIds?.[0] ?? null),
    };
  }

  updateUI(state);
  await updateToolbarControls();
  renderAyah(currentMatchedAyah);
  handleTranscriptError(currentTranscript);

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

    const showAr = currentUserPreferences.showArabic ?? true;
    const newKey = `${ayah.surah}:${ayah.ayah}:${ayah.index}:${showAr}:${currentUserPreferences.showTransliteration}:${currentUserPreferences.activeTransliterationId}:${activeTransId ?? 'none'}`;
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

      if (showAr) {
        ayahTextEl.hidden = false;
        const marker = ayah.ayahMarker ? `\u00A0${ayah.ayahMarker}` : '';
        ayahTextEl.textContent = `${ayah.uthmani}${marker}`.trim();
      } else {
        ayahTextEl.hidden = true;
      }

      let hasPrecedingContent = showAr;

      if (
        currentUserPreferences.showTransliteration &&
        currentUserPreferences.activeTransliterationId
      ) {
        const translitEdition = activeEditions.get(currentUserPreferences.activeTransliterationId);
        const text = translitEdition?.ayahs[ayah.index];
        if (text) {
          transliterationTextEl.textContent = text;
          transliterationContainerEl.hidden = false;
          transliterationContainerEl.style.borderTop = hasPrecedingContent ? '' : 'none';
          transliterationContainerEl.style.paddingTop = hasPrecedingContent ? '' : '0';
          hasPrecedingContent = true;
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
            if (!hasPrecedingContent) {
              block.style.borderTop = 'none';
              block.style.paddingTop = '0';
            }

            const label = document.createElement('span');
            label.className = 'ayah-translation-label';

            const bdi = document.createElement('bdi');
            bdi.textContent = getLanguageEndonym(edition.language);
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
  renderedAyahKey = '';
  renderAyah(currentMatchedAyah);
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

async function renderSettings(): Promise<void> {
  const cachedIds = new Set(await getCachedEditionIds());
  editionsListEl.innerHTML = '';

  for (const edition of CURATED_EDITIONS) {
    const isDownloading = downloadingEditions.has(edition.identifier);
    const isCached = cachedIds.has(edition.identifier);

    const item = document.createElement('div');
    item.className = 'edition-item';

    const info = document.createElement('div');
    info.className = 'edition-item__info';

    const name = document.createElement('span');
    name.className = 'edition-item__name';
    name.textContent = edition.nativeName;

    const sub = document.createElement('span');
    sub.className = 'edition-item__sub';

    const langTag = document.createElement('span');
    langTag.className = 'edition-item__lang-tag';
    langTag.textContent =
      edition.type === 'transliteration' ? 'Aa' : edition.language.toUpperCase();

    const detailText = document.createTextNode(
      edition.type === 'transliteration'
        ? (browser.i18n.getMessage('phoneticScript') ?? 'Phonetic Latin script')
        : `${edition.name} · ${edition.englishName}`,
    );

    sub.appendChild(langTag);
    sub.appendChild(detailText);

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

    item.appendChild(info);
    item.appendChild(action);
    editionsListEl.appendChild(item);
  }
}

async function selectTranslation(id: string | null): Promise<void> {
  let nextShowArabic = currentUserPreferences.showArabic ?? true;
  if (!id && !currentUserPreferences.showTransliteration && !nextShowArabic) {
    nextShowArabic = true;
  }

  currentUserPreferences = {
    ...currentUserPreferences,
    showArabic: nextShowArabic,
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
  await updateToolbarControls();
  await renderSettings();
}

async function downloadEdition(id: string): Promise<void> {
  downloadingEditions.add(id);
  await updateToolbarControls();
  await renderSettings();

  try {
    const downloaded = await fetchAndCacheEdition(id);
    activeEditions.set(id, downloaded);

    const editionMeta = CURATED_EDITIONS.find((e) => e.identifier === id);
    if (editionMeta?.type === 'translation') {
      if (!currentUserPreferences.activeTranslationId) {
        await selectTranslation(id);
      }
    } else if (editionMeta?.type === 'transliteration') {
      if (currentUserPreferences.showTransliteration) {
        renderedAyahKey = '';
        renderAyah(currentMatchedAyah);
      }
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

    if (nextActiveTransId === id) {
      nextActiveTransId = null;
    }
    if (currentUserPreferences.activeTransliterationId === id) {
      nextShowTranslit = false;
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
    };

    await userPreferencesItem.setValue(currentUserPreferences);
    renderedAyahKey = '';
    renderAyah(currentMatchedAyah);
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

  currentUserPreferences = {
    ...currentUserPreferences,
    showArabic: nextShowArabic,
    showTransliteration: enable,
  };

  const translitId = currentUserPreferences.activeTransliterationId;
  if (enable && !activeEditions.has(translitId)) {
    downloadingEditions.add(translitId);
    await updateToolbarControls();
    await renderSettings();

    try {
      const downloaded = await fetchAndCacheEdition(translitId);
      activeEditions.set(translitId, downloaded);
    } catch (err) {
      console.error('Failed to download transliteration edition:', err);
    } finally {
      downloadingEditions.delete(translitId);
      await updateToolbarControls();
      await renderSettings();
    }
  }

  await userPreferencesItem.setValue(currentUserPreferences);
  renderedAyahKey = '';
  renderAyah(currentMatchedAyah);
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
  renderAyah(currentMatchedAyah);
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
  settingsBtn.addEventListener('click', onSettingsOpen);
  settingsCloseBtn.addEventListener('click', onSettingsClose);
  settingsDialog.addEventListener('click', onDialogClick);
  window.addEventListener('online', onOnline);
  window.addEventListener('beforeunload', cleanup);

  unwatchState = captureStateItem.watch((newState: CaptureStateValue | null) => {
    const s = newState ?? CaptureState.IDLE;
    updateUI(s);
    renderAyah(currentMatchedAyah);
  });

  unwatchMatchedAyah = matchedAyahItem.watch((newAyah: MatchedAyah | null) => {
    renderAyah(newAyah);
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
        renderAyah(currentMatchedAyah);
        void updateToolbarControls();
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
  toggleArabicBtn?.removeEventListener('click', onArabicToggle);
  toggleTranslitBtn?.removeEventListener('click', onTranslitToggle);
  translationSelectEl?.removeEventListener('change', onTranslationChange);
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
