import { QuranMatcher, type QuranVerse } from '@/lib/matcher';
import { isExtensionMessage, MSG } from '@/lib/messages';

let matcher: QuranMatcher | null = null;
let matcherInitPromise: Promise<QuranMatcher> | null = null;

async function getMatcher(): Promise<QuranMatcher> {
  if (matcher) return matcher;
  if (!matcherInitPromise) {
    matcherInitPromise = (async () => {
      const response = await fetch(browser.runtime.getURL('/data/quran.json'));

      if (!response.ok) {
        throw new Error(`Failed to load Quran corpus: ${response.statusText}`);
      }
      const corpus: QuranVerse[] = await response.json();
      matcher = new QuranMatcher(corpus);
      return matcher;
    })();
  }
  return matcherInitPromise;
}

// Preload Quran corpus and construct inverted index eagerly on offscreen creation
getMatcher().catch((err: Error) => {
  console.error('QuranMatcher initialization error:', err);
});

let currentSessionId = 0;
let mediaStream: MediaStream | null = null;
let recognition: SpeechRecognition | null = null;
let audioContext: AudioContext | null = null;
let audioSource: MediaStreamAudioSourceNode | null = null;
let shouldReconnect = false;
let reconnectTimerId: ReturnType<typeof setTimeout> | null = null;
let lastReconnectTime = 0;
let consecutiveRestarts = 0;

const TRANSCRIPT_THROTTLE_MS = 200;
let lastTranscriptSent = '';
let lastTranscriptTime = 0;
let throttleTimerId: ReturnType<typeof setTimeout> | null = null;
let pendingTranscript: string | null = null;
let lastEmittedAyahIndex: number | null = null;

/**
 * Dispatches the transcript to the background service worker with both leading
 * and trailing edge guarantees. This prevents session storage queue saturation
 * while ensuring the terminal speech segment is reliably emitted when speech pauses.
 */
function sendTranscriptThrottled(transcript: string, sessionId: number): void {
  if (sessionId !== currentSessionId || transcript === lastTranscriptSent) return;

  const now = Date.now();
  const timeSinceLast = now - lastTranscriptTime;

  if (timeSinceLast >= TRANSCRIPT_THROTTLE_MS) {
    if (throttleTimerId !== null) {
      clearTimeout(throttleTimerId);
      throttleTimerId = null;
    }
    pendingTranscript = null;
    lastTranscriptTime = now;
    lastTranscriptSent = transcript;
    browser.runtime.sendMessage({ type: MSG.TRANSCRIPT, payload: transcript }).catch(() => {});
  } else {
    pendingTranscript = transcript;
    if (throttleTimerId === null) {
      const remaining = TRANSCRIPT_THROTTLE_MS - timeSinceLast;
      throttleTimerId = setTimeout(() => {
        throttleTimerId = null;
        if (
          sessionId === currentSessionId &&
          pendingTranscript &&
          pendingTranscript !== lastTranscriptSent
        ) {
          lastTranscriptTime = Date.now();
          lastTranscriptSent = pendingTranscript;
          const payload = pendingTranscript;
          pendingTranscript = null;
          browser.runtime.sendMessage({ type: MSG.TRANSCRIPT, payload }).catch(() => {});
        }
      }, remaining);
    }
  }
}

browser.runtime.onMessage.addListener((message: unknown) => {
  if (!isExtensionMessage(message)) return;

  if (message.type === MSG.STREAM_ID) {
    startCapture(message.payload);
  }

  if (message.type === MSG.STOP_CAPTURE) {
    stopCapture();
  }
});

// Handshake: notify background script that the offscreen document and listener are attached
browser.runtime.sendMessage({ type: MSG.OFFSCREEN_READY }).catch(() => {});

window.addEventListener('beforeunload', () => {
  stopCapture();
});

async function startCapture(streamId: string): Promise<void> {
  stopCapture();

  currentSessionId += 1;
  const thisSessionId = currentSessionId;

  try {
    const [localStream] = await Promise.all([
      navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamId,
          },
        } as unknown as MediaTrackConstraints,
      }),
      getMatcher(),
    ]);

    if (thisSessionId !== currentSessionId) {
      // Clean up orphaned tracks locally if a newer session began while awaiting getUserMedia
      for (const track of localStream.getTracks()) {
        track.stop();
      }
      return;
    }

    mediaStream = localStream;

    const audioTrack = mediaStream.getAudioTracks()[0];
    if (!audioTrack) {
      throw new Error('No audio track available from captured tab');
    }

    audioTrack.onended = () => {
      if (thisSessionId !== currentSessionId) return;
      stopCapture();
      browser.runtime.sendMessage({ type: MSG.CAPTURE_STOPPED }).catch(() => {});
    };

    // Forward audio to AudioContext destination so the tab remains audible to the user
    audioContext = new AudioContext();
    audioSource = audioContext.createMediaStreamSource(mediaStream);
    audioSource.connect(audioContext.destination);

    if (audioContext.state === 'suspended') {
      audioContext.resume().catch((err: Error) => {
        console.warn('AudioContext resume error:', err.message);
      });
    }

    shouldReconnect = true;
    startRecognition(thisSessionId, audioTrack);
  } catch (err) {
    if (thisSessionId === currentSessionId) {
      stopCapture();
      browser.runtime
        .sendMessage({
          type: MSG.ERROR,
          payload: `Capture failed: ${(err as Error).message}`,
        })
        .catch(() => {});
    }
  }
}

function startRecognition(sessionId: number, audioTrack?: MediaStreamTrack): void {
  if (sessionId !== currentSessionId) return;

  const SpeechRecognitionClass =
    typeof SpeechRecognition !== 'undefined'
      ? SpeechRecognition
      : typeof webkitSpeechRecognition !== 'undefined'
        ? webkitSpeechRecognition
        : null;

  if (!SpeechRecognitionClass) {
    stopCapture();
    browser.runtime
      .sendMessage({
        type: MSG.ERROR,
        payload: 'SpeechRecognition API not available',
      })
      .catch(() => {});
    return;
  }

  const currentTrack = audioTrack ?? mediaStream?.getAudioTracks()[0];
  if (!currentTrack) {
    stopCapture();
    browser.runtime
      .sendMessage({
        type: MSG.ERROR,
        payload: 'No valid audio track available for speech recognition',
      })
      .catch(() => {});
    return;
  }

  if (currentTrack.readyState === 'ended') {
    stopCapture();
    browser.runtime.sendMessage({ type: MSG.CAPTURE_STOPPED }).catch(() => {});
    return;
  }

  // Detach listeners from any prior recognition instance before re-instantiating
  if (recognition) {
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.abort();
    recognition = null;
  }

  recognition = new SpeechRecognitionClass();
  recognition.lang = 'ar-SA';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    if (sessionId !== currentSessionId) return;

    // Rolling context buffer: inspect the most recent 2-3 result segments so pauses
    // between phrases or words do not truncate continuous context for downstream matching.
    const segments: string[] = [];
    const startIndex = Math.max(0, event.results.length - 3);

    for (let i = startIndex; i < event.results.length; i++) {
      const item = event.results[i];
      if (item?.[0]) {
        const trimmed = item[0].transcript.trim();
        if (trimmed) {
          segments.push(trimmed);
        }
      }
    }

    const cleanTranscript = segments.join(' ').trim();
    if (!cleanTranscript) return;

    sendTranscriptThrottled(cleanTranscript, sessionId);

    if (matcher) {
      const match = matcher.match(cleanTranscript);
      if (match && match.index !== lastEmittedAyahIndex) {
        lastEmittedAyahIndex = match.index;
        browser.runtime.sendMessage({ type: MSG.AYAH_MATCH, payload: match }).catch(() => {});
      }
    }
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    if (sessionId !== currentSessionId) return;

    // Ignore silence pauses between verses and let onend handle reconnection
    if (event.error === 'aborted' || event.error === 'no-speech') {
      return;
    }

    shouldReconnect = false;
    stopCapture();
    browser.runtime
      .sendMessage({
        type: MSG.ERROR,
        payload: `Recognition error: ${event.error}`,
      })
      .catch(() => {});
  };

  recognition.onend = () => {
    if (sessionId !== currentSessionId) return;

    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition = null;
    }

    if (shouldReconnect && mediaStream) {
      const audioTrack = mediaStream.getAudioTracks()[0];
      if (audioTrack?.readyState !== 'live') {
        stopCapture();
        browser.runtime.sendMessage({ type: MSG.CAPTURE_STOPPED }).catch(() => {});
        return;
      }

      const now = Date.now();
      if (now - lastReconnectTime < 2000) {
        consecutiveRestarts += 1;
      } else {
        consecutiveRestarts = 0;
      }
      lastReconnectTime = now;

      // Exponential backoff: base 100ms, scaling up to 1500ms under rapid disconnects
      const delay = Math.min(100 * 1.5 ** consecutiveRestarts, 1500);

      if (reconnectTimerId !== null) {
        clearTimeout(reconnectTimerId);
      }
      reconnectTimerId = setTimeout(() => {
        reconnectTimerId = null;
        if (sessionId === currentSessionId && shouldReconnect) {
          startRecognition(sessionId, audioTrack);
        }
      }, delay);
    }
  };

  try {
    recognition.start(currentTrack);
  } catch (err) {
    if (sessionId !== currentSessionId) return;
    console.error('Failed to start SpeechRecognition:', err);
    stopCapture();
    browser.runtime
      .sendMessage({
        type: MSG.ERROR,
        payload: `Failed to start speech recognition: ${(err as Error).message}`,
      })
      .catch(() => {});
  }
}

function stopCapture(): void {
  currentSessionId += 1;
  shouldReconnect = false;

  if (throttleTimerId !== null) {
    clearTimeout(throttleTimerId);
    throttleTimerId = null;
  }
  pendingTranscript = null;
  lastTranscriptSent = '';
  lastTranscriptTime = 0;
  lastEmittedAyahIndex = null;

  if (reconnectTimerId !== null) {
    clearTimeout(reconnectTimerId);
    reconnectTimerId = null;
  }
  consecutiveRestarts = 0;
  lastReconnectTime = 0;

  matcher?.reset();

  if (recognition) {
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.abort();
    recognition = null;
  }

  if (audioSource) {
    audioSource.disconnect();
    audioSource = null;
  }

  if (audioContext) {
    audioContext.close().catch((err: Error) => {
      console.warn('AudioContext close error:', err.message);
    });
    audioContext = null;
  }

  // Stopping media tracks releases Chromium's active tabCapture stream lock
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.onended = null;
      track.stop();
    }
    mediaStream = null;
  }
}
