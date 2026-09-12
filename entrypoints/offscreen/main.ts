import { MSG, isExtensionMessage } from '@/lib/messages';

let mediaStream: MediaStream | null = null;
let recognition: SpeechRecognition | null = null;
let audioContext: AudioContext | null = null;
let audioSource: MediaStreamAudioSourceNode | null = null;
let shouldReconnect = false;
let currentSessionId = 0;

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
browser.runtime.sendMessage({ type: MSG.OFFSCREEN_READY });

window.addEventListener('beforeunload', () => {
  stopCapture();
});

async function startCapture(streamId: string): Promise<void> {
  // Release any previous tracks or sessions before requesting a new stream
  stopCapture();

  // Increment and capture unique sessionId for this capture run
  currentSessionId += 1;
  const thisSessionId = currentSessionId;

  try {
    const localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      } as unknown as MediaTrackConstraints,
    });

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
      browser.runtime.sendMessage({ type: MSG.CAPTURE_STOPPED });
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
      browser.runtime.sendMessage({
        type: MSG.ERROR,
        payload: `Capture failed: ${(err as Error).message}`,
      });
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
    browser.runtime.sendMessage({
      type: MSG.ERROR,
      payload: 'SpeechRecognition API not available',
    });
    return;
  }

  const currentTrack = audioTrack ?? mediaStream?.getAudioTracks()[0];
  if (!currentTrack) {
    browser.runtime.sendMessage({
      type: MSG.ERROR,
      payload: 'No valid audio track available for speech recognition',
    });
    return;
  }

  if (currentTrack.readyState === 'ended') {
    // Orderly teardown: audio source ended externally (e.g. tab closed or navigation)
    stopCapture();
    browser.runtime.sendMessage({ type: MSG.CAPTURE_STOPPED });
    return;
  }

  recognition = new SpeechRecognitionClass();
  recognition.lang = 'ar-SA';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    if (sessionId !== currentSessionId) return;

    const segments: string[] = [];
    // Emit only current recognition slice from resultIndex rather than accumulating full history
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const item = event.results[i];
      if (item?.[0]) {
        const trimmed = item[0].transcript.trim();
        if (trimmed) {
          segments.push(trimmed);
        }
      }
    }
    
    // Preserve single-space word boundaries across discrete result segments
    const cleanTranscript = segments.join(' ').trim();
    if (cleanTranscript) {
      browser.runtime.sendMessage({ type: MSG.TRANSCRIPT, payload: cleanTranscript });
    }
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    if (sessionId !== currentSessionId) return;
    
    // Ignore silence pauses between verses and let onend handle reconnection
    if (event.error === 'aborted' || event.error === 'no-speech') {
      return;
    }

    // Stop reconnecting on fatal audio/network failures to prevent retry loops
    shouldReconnect = false;
    browser.runtime.sendMessage({
      type: MSG.ERROR,
      payload: `Recognition error: ${event.error}`,
    });
  };

  recognition.onend = () => {
    if (sessionId !== currentSessionId) return;
    if (shouldReconnect && mediaStream) {
      startRecognition(sessionId);
    }
  };

  try {
    recognition.start(currentTrack);
  } catch (err) {
    if (sessionId !== currentSessionId) return;
    console.error('Failed to start SpeechRecognition:', err);
    browser.runtime.sendMessage({
      type: MSG.ERROR,
      payload: `Failed to start speech recognition: ${(err as Error).message}`,
    });
  }
}

function stopCapture(): void {
  currentSessionId += 1;
  shouldReconnect = false;

  // 1. Abort speech recognition to prevent looping against dying tracks
  if (recognition) {
    recognition.abort();
    recognition = null;
  }

  // 2. Tear down AudioContext bridge
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

  // 3. Release media tracks to clear the Chromium tabCapture stream lock
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
    mediaStream = null;
  }
}
