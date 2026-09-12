import {
  type CaptureResponseMessage,
  MSG,
  isExtensionMessage,
} from '@/lib/messages';
import {
  activeTabIdItem,
  CaptureState,
  type CaptureStateValue,
  captureStateItem,
  transcriptItem,
} from '@/lib/state';

export default defineBackground(() => {
  // Reconcile cold-start state: if the service worker terminated or restarted while
  // in a non-idle state, verify whether an offscreen document actually exists.
  reconcileState().catch((err) => {
    console.warn('Initial state reconciliation error:', err);
  });

  // Capture user gesture via toolbar action click to grant activeTab and open side panel
  browser.action.onClicked.addListener(async (tab) => {
    // Preserve the user gesture token synchronously before any await boundary
    if (tab.windowId !== undefined) {
      browser.sidePanel.open({ windowId: tab.windowId }).catch((err) => {
        console.warn('Non-fatal sidePanel.open error:', err);
      });
    }

    let currentState = await captureStateItem.getValue();

    // Self-healing: if state indicates an active session, verify an offscreen context actually exists
    if (currentState !== CaptureState.IDLE) {
      const offscreenExists = await hasOffscreenDocument();
      if (!offscreenExists) {
        await handleStopCapture({ notifyOffscreen: false });
        currentState = CaptureState.IDLE;
      }
    }

    if (currentState === CaptureState.STARTING || currentState === CaptureState.STOPPING) {
      return;
    }

    if (currentState === CaptureState.CAPTURING) {
      await handleStopCapture();
      return;
    }

    try {
      if (tab.id !== undefined) {
        await handleStartCapture(tab.id);
      }
    } catch (err) {
      console.error('Failed to initialize capture from action click:', err);
      await captureStateItem.setValue(CaptureState.IDLE);
      await updateBadge(CaptureState.IDLE);
      await transcriptItem.setValue(`Error: ${(err as Error).message}`);
    }
  });

  browser.tabs.onRemoved.addListener(async (closedTabId) => {
    const activeTabId = await activeTabIdItem.getValue();
    if (closedTabId === activeTabId) {
      await handleStopCapture();
    }
  });

  // Release capture if the captured tab navigates, reloads, or changes URL (SPA navigation)
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    const activeTabId = await activeTabIdItem.getValue();
    if (tabId === activeTabId && (changeInfo.status === 'loading' || Boolean(changeInfo.url))) {
      await handleStopCapture();
    }
  });

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isExtensionMessage(message)) return;

    if (message.type === MSG.START_CAPTURE) {
      handleStartCapture()
        .then(sendResponse)
        .catch((err: Error) => {
          console.error('Capture Start Error:', err);
          captureStateItem.setValue(CaptureState.IDLE);
          updateBadge(CaptureState.IDLE);
          sendResponse({ type: MSG.ERROR, payload: err.message });
        });
      return true;
    }

    if (message.type === MSG.STOP_CAPTURE) {
      handleStopCapture()
        .then(sendResponse)
        .catch((err: Error) => {
          sendResponse({ type: MSG.ERROR, payload: err.message });
        });
      return true;
    }

    if (message.type === MSG.CAPTURE_STOPPED) {
      handleStopCapture({ notifyOffscreen: false })
        .then(sendResponse)
        .catch((err: Error) => {
          sendResponse({ type: MSG.ERROR, payload: err.message });
        });
      return true;
    }

    if (message.type === MSG.TRANSCRIPT) {
      transcriptItem.setValue(message.payload);
      return;
    }

    if (message.type === MSG.ERROR) {
      console.error('Offscreen Error:', message.payload);
      captureStateItem.setValue(CaptureState.IDLE);
      transcriptItem.setValue(`Error: ${message.payload}`);
      updateBadge(CaptureState.IDLE);
      return;
    }
  });

  async function handleStartCapture(explicitTabId?: number): Promise<CaptureResponseMessage> {
    let state = await captureStateItem.getValue();

    if (state !== CaptureState.IDLE) {
      const offscreenExists = await hasOffscreenDocument();
      if (!offscreenExists) {
        await handleStopCapture({ notifyOffscreen: false });
        state = CaptureState.IDLE;
      }
    }

    if (state === CaptureState.STARTING || state === CaptureState.STOPPING) {
      return { type: MSG.ERROR, payload: 'Operation in progress' };
    }

    if (state === CaptureState.CAPTURING) {
      return { type: MSG.ERROR, payload: 'Already capturing' };
    }

    await captureStateItem.setValue(CaptureState.STARTING);
    await transcriptItem.setValue('');

    try {
      await ensureOffscreenDocument();

      let targetTabId = explicitTabId;
      if (!targetTabId) {
        const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
        targetTabId = tab?.id;
      }

      if (!targetTabId) {
        throw new Error('No active tab found');
      }

      const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId });

      await browser.runtime.sendMessage({ type: MSG.STREAM_ID, payload: streamId });
      await captureStateItem.setValue(CaptureState.CAPTURING);
      await activeTabIdItem.setValue(targetTabId);
      await updateBadge(CaptureState.CAPTURING);

      return { type: MSG.CAPTURE_STARTED };
    } catch (err) {
      await captureStateItem.setValue(CaptureState.IDLE);
      await updateBadge(CaptureState.IDLE);
      throw err;
    }
  }

  async function handleStopCapture(
    options: { notifyOffscreen?: boolean } = { notifyOffscreen: true },
  ): Promise<CaptureResponseMessage> {
    await captureStateItem.setValue(CaptureState.STOPPING);

    if (options.notifyOffscreen) {
      // Fire-and-forget: do not await offscreen response to prevent hanging if offscreen is unresponsive
      browser.runtime.sendMessage({ type: MSG.STOP_CAPTURE }).catch(() => {});
    }

    await captureStateItem.setValue(CaptureState.IDLE);
    await activeTabIdItem.setValue(null);
    await updateBadge(CaptureState.IDLE);

    return { type: MSG.CAPTURE_STOPPED };
  }

  async function updateBadge(state: CaptureStateValue): Promise<void> {
    if (state === CaptureState.CAPTURING) {
      await browser.action.setBadgeText({ text: 'REC' });
      await browser.action.setBadgeBackgroundColor({ color: '#DC2626' });
    } else {
      await browser.action.setBadgeText({ text: '' });
    }
  }

  async function hasOffscreenDocument(): Promise<boolean> {
    try {
      if (browser.offscreen && typeof browser.offscreen.hasDocument === 'function') {
        return await browser.offscreen.hasDocument();
      }
      if (browser.runtime && typeof browser.runtime.getContexts === 'function') {
        const contexts = await browser.runtime.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT'],
        });
        return contexts.length > 0;
      }
    } catch (err) {
      console.warn('Failed to query offscreen contexts:', err);
    }
    return false;
  }

  async function reconcileState(): Promise<void> {
    const currentState = await captureStateItem.getValue();
    if (currentState !== CaptureState.IDLE) {
      const offscreenExists = await hasOffscreenDocument();
      if (!offscreenExists) {
        console.info('Reconciling stale capture state on service worker wake-up:', currentState);
        await captureStateItem.setValue(CaptureState.IDLE);
        await activeTabIdItem.setValue(null);
        await updateBadge(CaptureState.IDLE);
      }
    }
  }

  async function ensureOffscreenDocument(): Promise<void> {
    if (await hasOffscreenDocument()) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let listener: ((message: unknown) => void) | undefined;

    try {
      const readyPromise = new Promise<void>((resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('Offscreen document creation timed out awaiting ready signal'));
        }, 5000);

        listener = (message: unknown) => {
          if (isExtensionMessage(message) && message.type === MSG.OFFSCREEN_READY) {
            resolve();
          }
        };
        browser.runtime.onMessage.addListener(listener);
      });

      await browser.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Capture tab audio for Arabic speech recognition',
      });

      await readyPromise;
    } catch (err) {
      if (await hasOffscreenDocument()) {
        await browser.offscreen.closeDocument().catch(() => {});
      }
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (listener) browser.runtime.onMessage.removeListener(listener);
    }
  }
});
