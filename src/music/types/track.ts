export type TrackSource = 'youtube' | 'spotify' | 'soundcloud' | 'local' | 'http';

export interface Track {
  /** Unique internal track identifier (UUID) */
  id: string;
  /** Encoded track string provided by Lavalink */
  encodedTrack: string;
  /** Track title */
  title: string;
  /** Artist / channel / uploader */
  author: string;
  /** Duration in milliseconds */
  duration: number;
  /** Web or file URI */
  uri: string;
  /** Audio source identifier */
  source: TrackSource;
  /** Thumbnail image URL if available */
  thumbnail?: string;
  /** Album name if available */
  album?: string;
  /** Discord ID of the user who requested the track */
  requesterId: string;
  /** Whether the track duration is live / infinite stream */
  isStream?: boolean;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

export interface PlaylistInfo {
  name: string;
  selectedTrack?: number;
  duration: number;
  tracks: Track[];
}

export type RepeatMode = 'off' | 'track' | 'queue';
