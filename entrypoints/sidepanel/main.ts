import { type CaptureResponseMessage, MSG } from '@/lib/messages';
import {
  CaptureState,
  type CaptureStateValue,
  captureStateItem,
  type MatchedAyah,
  matchedAyahItem,
  transcriptItem,
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
let ayahTextEl: HTMLElement;
let liveSpeechStrip: HTMLElement;
let liveSpeechTextEl: HTMLElement;

let currentCaptureState: CaptureStateValue = CaptureState.IDLE;
let currentMatchedAyah: MatchedAyah | null = null;
let renderedAyahKey = '';
let currentTranscript = '';
let activeTabRequired = false;
let isToggling = false;

let unwatchState: (() => void) | undefined;
let unwatchTranscript: (() => void) | undefined;
let unwatchMatchedAyah: (() => void) | undefined;

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
  const ayahTxt = document.getElementById('ayah-text');
  const liveStrip = document.getElementById('live-speech-strip');
  const liveText = document.getElementById('live-speech-text');

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
    !ayahTxt ||
    !liveStrip ||
    !liveText
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
  ayahTextEl = ayahTxt;
  liveSpeechStrip = liveStrip;
  liveSpeechTextEl = liveText;

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

  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
    const key = el.dataset.i18nPlaceholder as I18nKey | undefined;
    if (key) el.dataset.placeholder = browser.i18n.getMessage(key);
  }
}

async function hydrateState(): Promise<void> {
  const [state, transcript, matchedAyah] = await Promise.all([
    captureStateItem.getValue(),
    transcriptItem.getValue(),
    matchedAyahItem.getValue(),
  ]);

  currentCaptureState = state;
  currentTranscript = transcript ?? '';
  currentMatchedAyah = matchedAyah ?? null;

  updateUI(state);
  renderAyah(currentMatchedAyah);
  renderTranscript(currentTranscript);
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

    const newKey = `${ayah.surah}:${ayah.ayah}:${ayah.index}`;
    if (renderedAyahKey !== newKey) {
      renderedAyahKey = newKey;

      surahArabicEl.textContent = ayah.surahNameArabic
        ? `سورة ${ayah.surahNameArabic}`
        : `سورة ${ayah.surah}`;
      surahEnglishEl.textContent = ayah.surahNameEnglish ?? '';

      ayahBadgeEl.textContent = ayah.totalAyahs
        ? `${ayah.surah}:${ayah.ayah} (${ayah.ayah}/${ayah.totalAyahs})`
        : `${ayah.surah}:${ayah.ayah}`;

      const marker = ayah.ayahMarker ? `\u00A0${ayah.ayahMarker}` : '';
      ayahTextEl.textContent = `${ayah.uthmani}${marker}`.trim();
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

async function init(): Promise<void> {
  if (!queryDOMElements()) return;

  localizeUI();
  await hydrateState();

  toggleBtn.addEventListener('click', handleToggle);

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

  window.addEventListener('beforeunload', cleanup);
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
  toggleBtn?.removeEventListener('click', handleToggle);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch(console.error);
  });
} else {
  init().catch(console.error);
}
