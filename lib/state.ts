import { storage } from 'wxt/utils/storage';

export const CaptureState = {
  IDLE: 'idle',
  STARTING: 'starting',
  CAPTURING: 'capturing',
  STOPPING: 'stopping',
} as const;

export type CaptureStateValue = (typeof CaptureState)[keyof typeof CaptureState];

export const captureStateItem = storage.defineItem<CaptureStateValue>('session:captureState', {
  fallback: CaptureState.IDLE,
});

export const activeTabIdItem = storage.defineItem<number | null>('session:activeTabId', {
  fallback: null,
});

export const transcriptItem = storage.defineItem<string>('session:transcript', {
  fallback: '',
});
