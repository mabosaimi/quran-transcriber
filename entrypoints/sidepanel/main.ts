import { type ExtensionMessage, MSG } from '@/lib/messages';
import {
  CaptureState,
  type CaptureStateValue,
  captureStateItem,
  transcriptItem,
} from '@/lib/state';

const toggleBtn = document.getElementById('toggle-btn') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const transcriptEl = document.getElementById('transcript') as HTMLDivElement;

async function init(): Promise<void> {
  localizeUI();
  await hydrateState();

  toggleBtn.addEventListener('click', handleToggle);

  captureStateItem.watch((newState: CaptureStateValue | null) => {
    updateUI(newState ?? CaptureState.IDLE);
  });

  transcriptItem.watch((newTranscript: string | null) => {
    renderTranscript(newTranscript ?? '');
  });
}

type I18nKey = Parameters<typeof browser.i18n.getMessage>[0];

function localizeUI(): void {
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
  const [currentState, currentTranscript] = await Promise.all([
    captureStateItem.getValue(),
    transcriptItem.getValue(),
  ]);

  updateUI(currentState);
  if (currentTranscript) {
    renderTranscript(currentTranscript);
  }
}

async function handleToggle(): Promise<void> {
  const state = await captureStateItem.getValue();
  const type = state === CaptureState.CAPTURING ? MSG.STOP_CAPTURE : MSG.START_CAPTURE;

  toggleBtn.disabled = true;
  try {
    await browser.runtime.sendMessage({ type } as ExtensionMessage);
  } finally {
    toggleBtn.disabled = false;
  }
}

function updateUI(state: CaptureStateValue): void {
  const isCapturing = state === CaptureState.CAPTURING;
  const isTransitioning = state === CaptureState.STARTING || state === CaptureState.STOPPING;

  toggleBtn.textContent = browser.i18n.getMessage(isCapturing ? 'stopCapture' : 'startCapture');
  toggleBtn.disabled = isTransitioning;

  statusEl.textContent = browser.i18n.getMessage(isCapturing ? 'statusCapturing' : 'statusIdle');
  statusEl.className = `status status--${state}`;
}

function renderTranscript(text: string): void {
  transcriptEl.textContent = text;
}

document.addEventListener('DOMContentLoaded', init);
