export const MSG = {
  START_CAPTURE: 'start-capture',
  STOP_CAPTURE: 'stop-capture',
  CAPTURE_STARTED: 'capture-started',
  CAPTURE_STOPPED: 'capture-stopped',
  STREAM_ID: 'stream-id',
  TRANSCRIPT: 'transcript',
  STATUS_UPDATE: 'status-update',
  ERROR: 'error',
} as const;

export type MessageType = (typeof MSG)[keyof typeof MSG];

export interface ExtensionMessage {
  type: MessageType;
  payload?: unknown;
}
