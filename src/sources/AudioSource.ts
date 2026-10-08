import { Track } from '../music/types/track';
import { Shoukaku } from 'shoukaku';
import { Logger } from 'pino';

export interface ResolvedResult {
  type: 'track' | 'playlist' | 'search';
  tracks: Track[];
  playlistName?: string;
}

export interface SourceContext {
  requesterId: string;
  shoukaku: Shoukaku;
  logger: Logger;
  fallbackResolver?: (query: string, requesterId: string) => Promise<ResolvedResult>;
}

export interface AudioSource {
  readonly name: string;
  readonly priority: number;
  supports(input: string): boolean;
  resolve(input: string, context: SourceContext): Promise<ResolvedResult>;
}
