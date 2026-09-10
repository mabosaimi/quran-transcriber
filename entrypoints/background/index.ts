import { type ExtensionMessage, MSG } from '@/lib/messages';
import { activeTabIdItem, CaptureState, captureStateItem, transcriptItem } from '@/lib/state';

export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  browser.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === MSG.START_CAPTURE) {
      handleStartCapture()
        .then(sendResponse)
        .catch((err: Error) => {
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

    if (message.type === MSG.TRANSCRIPT) {
      transcriptItem.setValue(message.payload as string);
    }
  });

  async function handleStartCapture(): Promise<ExtensionMessage> {
    const state = await captureStateItem.getValue();

    if (state === CaptureState.STARTING || state === CaptureState.STOPPING) {
      return { type: MSG.ERROR, payload: 'Operation in progress' };
    }

    if (state === CaptureState.CAPTURING) {
      return { type: MSG.ERROR, payload: 'Already capturing' };
    }

    await captureStateItem.setValue(CaptureState.STARTING);

    try {
      await ensureOffscreenDocument();

      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error('No active tab found');
      }

      const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tab.id });

      await browser.runtime.sendMessage({ type: MSG.STREAM_ID, payload: streamId });
      await captureStateItem.setValue(CaptureState.CAPTURING);
      await activeTabIdItem.setValue(tab.id);

      return { type: MSG.CAPTURE_STARTED };
    } catch (err) {
      await captureStateItem.setValue(CaptureState.IDLE);
      throw err;
    }
  }

  async function handleStopCapture(): Promise<ExtensionMessage> {
    await captureStateItem.setValue(CaptureState.STOPPING);

    try {
      await browser.runtime.sendMessage({ type: MSG.STOP_CAPTURE });
    } finally {
      await captureStateItem.setValue(CaptureState.IDLE);
      await activeTabIdItem.setValue(null);
    }

    return { type: MSG.CAPTURE_STOPPED };
  }

  async function ensureOffscreenDocument(): Promise<void> {
    const contexts = await browser.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });

    if (contexts.length > 0) return;

    await browser.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Capture tab audio for Arabic speech recognition',
    });
  }
});
