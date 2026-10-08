import { AudioSource } from './AudioSource';
import { YouTubeSource } from './YouTubeSource';
import { SpotifySource } from './SpotifySource';
import { SoundCloudSource } from './SoundCloudSource';
import { LocalSource } from './LocalSource';
import { DirectUrlSource } from './DirectUrlSource';
import { EnvConfig } from '../config/env';
import { SourceError } from '../utils/errors';

export class SourceManager {
  private readonly sources = new Map<string, AudioSource>();
  private defaultSearchSource = 'youtube';

  constructor(config?: EnvConfig) {
    // Register standard out-of-the-box sources
    this.registerSource(new SpotifySource());
    this.registerSource(new YouTubeSource());
    this.registerSource(new SoundCloudSource());
    this.registerSource(new LocalSource());
    this.registerSource(new DirectUrlSource());

    if (config) {
      this.defaultSearchSource = config.DEFAULT_SEARCH_SOURCE;
    }
  }

  public registerSource(source: AudioSource): void {
    this.sources.set(source.name.toLowerCase(), source);
  }

  public getSource(name: string): AudioSource | undefined {
    return this.sources.get(name.toLowerCase());
  }

  public getAllSources(): AudioSource[] {
    return Array.from(this.sources.values()).sort((a, b) => a.priority - b.priority);
  }

  public findSource(input: string): AudioSource {
    const trimmed = input.trim();
    const sorted = this.getAllSources();

    // 1. Check if any source specifically recognizes this input (URL pattern, prefix, etc.)
    for (const source of sorted) {
      if (source.supports(trimmed)) {
        return source;
      }
    }

    // 2. Input is a plain search query (e.g. "Taylor Swift - Cruel Summer")
    const searchSource = this.sources.get(this.defaultSearchSource);
    if (searchSource) {
      return searchSource;
    }

    // Fallback to first available source
    const fallback = sorted[0];
    if (!fallback) {
      throw new SourceError(
        'UNSUPPORTED_SOURCE',
        'No audio sources are registered in SourceManager',
        'No audio sources are configured on this server.'
      );
    }

    return fallback;
  }
}
