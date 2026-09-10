import { type ExtensionMessage, MSG } from '@/lib/messages';

let mediaStream: MediaStream | null = null;
let recognition: SpeechRecognition | null = null;
let shouldReconnect = false;

browser.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === MSG.STREAM_ID) {
    startCapture(message.payload as string);
  }

  if (message.type === MSG.STOP_CAPTURE) {
    stopCapture();
  }
});

async function startCapture(streamId: string): Promise<void> {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      } as unknown as MediaTrackConstraints,
    });

    const audio = new Audio();
    audio.srcObject = mediaStream;
    audio.play();

    shouldReconnect = true;
    startRecognition();
  } catch (err) {
    browser.runtime.sendMessage({
      type: MSG.ERROR,
      payload: `Capture failed: ${(err as Error).message}`,
    });
  }
}

function startRecognition(): void {
  const SpeechRecognitionClass =
    typeof SpeechRecognition !== 'undefined'
      ? SpeechRecognition
      : typeof webkitSpeechRecognition !== 'undefined'
        ? webkitSpeechRecognition
        : null;

  if (!SpeechRecognitionClass) {
    browser.runtime.sendMessage({
      type: MSG.ERROR,
      payload: 'SpeechRecognition API not available',
    });
    return;
  }

  recognition = new SpeechRecognitionClass();
  recognition.lang = 'ar';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    let transcript = '';
    for (let i = 0; i < event.results.length; i++) {
      const item = event.results[i];
      if (item?.[0]) {
        transcript += item[0].transcript;
      }
    }
    browser.runtime.sendMessage({ type: MSG.TRANSCRIPT, payload: transcript });
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    if (event.error === 'aborted') return;

    browser.runtime.sendMessage({
      type: MSG.ERROR,
      payload: `Recognition error: ${event.error}`,
    });
  };

  recognition.onend = () => {
    if (shouldReconnect) {
      startRecognition();
    }
  };

  recognition.start();
}

function stopCapture(): void {
  shouldReconnect = false;

  if (recognition) {
    recognition.abort();
    recognition = null;
  }

  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
    mediaStream = null;
  }
}
