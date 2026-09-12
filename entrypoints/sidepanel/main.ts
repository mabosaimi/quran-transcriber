import {
  type CaptureResponseMessage,
  MSG,
} from '@/lib/messages';
import {
  CaptureState,
  type CaptureStateValue,
  captureStateItem,
  transcriptItem,
} from '@/lib/state';

type I18nKey = Parameters<typeof browser.i18n.getMessage>[0];

// Cached element references, initialized safely after DOM readiness
let toggleBtn: HTMLButtonElement;
let idleHint: HTMLElement;
let statusEl: HTMLElement;
let transcriptEl: HTMLElement;

// State flags for deterministic UI transitions
let activeTabRequired = false;
let isToggling = false;

// Subscriptions to clean up on sidepanel unload
let unwatchState: (() => void) | undefined;
let unwatchTranscript: (() => void) | undefined;

function queryDOMElements(): boolean {
  const btn = document.getElementById('toggle-btn') as HTMLButtonElement | null;
  const hint = document.getElementById('idle-hint');
  const status = document.getElementById('status');
  const transcript = document.getElementById('transcript');

  if (!btn || !hint || !status || !transcript) {
    console.error('Missing required side panel DOM elements');
    return false;
  }

  toggleBtn = btn;
  idleHint = hint;
  statusEl = status;
  transcriptEl = transcript;
  return true;
}

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
  renderTranscript(currentTranscript ?? '');
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
          // Flag that activeTab permission is required via toolbar icon
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
  const isCapturing = state === CaptureState.CAPTURING;
  const isTransitioning =
    state === CaptureState.STARTING || state === CaptureState.STOPPING;

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
      // Prompt user to click toolbar action to satisfy activeTab permission requirement
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

  statusEl.textContent = browser.i18n.getMessage(
    isCapturing ? 'statusCapturing' : 'statusIdle',
  );
  statusEl.className = `status status--${state}`;
}

function renderTranscript(text: string): void {
  transcriptEl.textContent = text;
  if (text.startsWith('Error:')) {
    transcriptEl.classList.add('transcript--error');
  } else {
    transcriptEl.classList.remove('transcript--error');
  }
  // Auto-scroll to bottom as new speech segments arrive
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

async function init(): Promise<void> {
  if (!queryDOMElements()) return;

  localizeUI();
  await hydrateState();

  toggleBtn.addEventListener('click', handleToggle);

  unwatchState = captureStateItem.watch((newState: CaptureStateValue | null) => {
    updateUI(newState ?? CaptureState.IDLE);
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
  if (unwatchTranscript) {
    unwatchTranscript();
    unwatchTranscript = undefined;
  }
  toggleBtn?.removeEventListener('click', handleToggle);
}

// Bootstrap initialization based on document readyState
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch(console.error);
  });
} else {
  init().catch(console.error);
}
