export const MSG = {
  START_CAPTURE: 'start-capture',
  STOP_CAPTURE: 'stop-capture',
  CAPTURE_STARTED: 'capture-started',
  CAPTURE_STOPPED: 'capture-stopped',
  STREAM_ID: 'stream-id',
  TRANSCRIPT: 'transcript',
  ERROR: 'error',
  OFFSCREEN_READY: 'offscreen-ready',
} as const;

export type MessageType = (typeof MSG)[keyof typeof MSG];

export interface StartCaptureMessage {
  type: typeof MSG.START_CAPTURE;
}

export interface StopCaptureMessage {
  type: typeof MSG.STOP_CAPTURE;
}

export interface CaptureStartedMessage {
  type: typeof MSG.CAPTURE_STARTED;
}

export interface CaptureStoppedMessage {
  type: typeof MSG.CAPTURE_STOPPED;
}

export interface StreamIdMessage {
  type: typeof MSG.STREAM_ID;
  payload: string;
}

export interface TranscriptMessage {
  type: typeof MSG.TRANSCRIPT;
  payload: string;
}

export interface ErrorMessage {
  type: typeof MSG.ERROR;
  payload: string;
}

export interface OffscreenReadyMessage {
  type: typeof MSG.OFFSCREEN_READY;
}

export type ExtensionMessage =
  | StartCaptureMessage
  | StopCaptureMessage
  | CaptureStartedMessage
  | CaptureStoppedMessage
  | StreamIdMessage
  | TranscriptMessage
  | ErrorMessage
  | OffscreenReadyMessage;

export type CaptureResponseMessage =
  | CaptureStartedMessage
  | CaptureStoppedMessage
  | ErrorMessage;

/**
 * Type guard to validate whether an unknown value is a valid ExtensionMessage.
 * Guarantees safe narrowing and prevents malformed message objects from causing runtime faults.
 */
export function isExtensionMessage(msg: unknown): msg is ExtensionMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const candidate = msg as { type?: unknown; payload?: unknown };
  if (typeof candidate.type !== 'string') return false;

  switch (candidate.type) {
    case MSG.START_CAPTURE:
    case MSG.STOP_CAPTURE:
    case MSG.CAPTURE_STARTED:
    case MSG.CAPTURE_STOPPED:
    case MSG.OFFSCREEN_READY:
      return true;
    case MSG.STREAM_ID:
    case MSG.TRANSCRIPT:
    case MSG.ERROR:
      return typeof candidate.payload === 'string';
    default:
      return false;
  }
}
