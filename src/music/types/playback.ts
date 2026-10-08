import { Track } from './track';

export type PlaybackState =
  | 'IDLE'
  | 'BUFFERING'
  | 'PLAYING'
  | 'PAUSED'
  | 'ENDED'
  | 'ERROR';

export interface PlaybackStatus {
  state: PlaybackState;
  currentTrack: Track | null;
  position: number; // Current playback position in milliseconds
  volume: number; // 0 to 100
  paused: boolean;
  repeatMode: 'off' | 'track' | 'queue';
  shuffle: boolean;
  autoplay: boolean;
}

export interface PlaybackEvents {
  trackStart: (track: Track) => void;
  trackEnd: (track: Track, reason: string) => void;
  trackException: (track: Track, error: Error) => void;
  trackStuck: (track: Track, thresholdMs: number) => void;
  stateChange: (oldState: PlaybackState, newState: PlaybackState) => void;
  queueEnd: () => void;
  playerDestroyed: () => void;
}
