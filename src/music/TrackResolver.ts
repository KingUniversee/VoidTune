import { Shoukaku } from 'shoukaku';
import { Logger } from 'pino';
import { SourceManager } from '../sources/SourceManager';
import { ResolvedResult, SourceContext } from '../sources/AudioSource';
import { SourceError } from '../utils/errors';

interface CachedEntry {
  result: ResolvedResult;
  expiresAt: number;
}

export class TrackResolver {
  private readonly sourceManager: SourceManager;
  private readonly shoukaku: Shoukaku;
  private readonly logger: Logger;
  private readonly cache = new Map<string, CachedEntry>();
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private readonly MAX_CACHE_ENTRIES = 200;

  constructor(sourceManager: SourceManager, shoukaku: Shoukaku, logger: Logger) {
    this.sourceManager = sourceManager;
    this.shoukaku = shoukaku;
    this.logger = logger.child({ module: 'TrackResolver' });
  }

  public async resolve(query: string, requesterId: string): Promise<ResolvedResult> {
    const trimmed = query.trim();
    if (!trimmed) {
      throw new SourceError(
        'INVALID_QUERY',
        'Cannot resolve empty query',
        'Please specify a song name or link to play.'
      );
    }

    // 1. Check in-memory metadata cache (excluding local files)
    const isLocal = trimmed.startsWith('local:') || trimmed.startsWith('file://');
    const cacheKey = trimmed.toLowerCase();

    if (!isLocal) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        this.logger.debug({ query: trimmed }, 'Cache hit for track resolution');
        // Return fresh clone with current requesterId
        return {
          type: cached.result.type,
          playlistName: cached.result.playlistName,
          tracks: cached.result.tracks.map((t) => ({
            ...t,
            requesterId,
          })),
        };
      }
    }

    // 2. Select matching source adapter
    const source = this.sourceManager.findSource(trimmed);
    this.logger.info(
      { query: trimmed, selectedSource: source.name },
      'Selected source adapter for query'
    );

    // 3. Prepare SourceContext with recursive fallback resolver
    const context: SourceContext = {
      requesterId,
      shoukaku: this.shoukaku,
      logger: this.logger,
      fallbackResolver: async (fallbackQuery: string, reqId: string) => {
        // Fallback resolver uses the primary search source (e.g. YouTube)
        const fallbackSource = this.sourceManager.findSource(fallbackQuery);
        return fallbackSource.resolve(fallbackQuery, {
          requesterId: reqId,
          shoukaku: this.shoukaku,
          logger: this.logger,
        });
      },
    };

    // 4. Execute Resolution with resilient fallback for generic searches
    const isDirectUrl = /^(https?:\/\/)/i.test(trimmed);
    const isExplicitPrefix = trimmed.includes(':');

    let result: ResolvedResult;
    try {
      result = await source.resolve(trimmed, context);
    } catch (sourceErr) {
      if (!isDirectUrl && !isExplicitPrefix) {
        this.logger.warn(
          { query: trimmed, failedSource: source.name, error: sourceErr },
          'Initial search source resolution failed, attempting cascading fallback'
        );
        result = await this.cascadeFallback(trimmed, source.name, context);
      } else {
        throw sourceErr;
      }
    }

    if (result.tracks.length === 0 && !isDirectUrl && !isExplicitPrefix) {
      this.logger.info(
        { query: trimmed, source: source.name },
        'Initial source returned 0 tracks, attempting cascading fallback'
      );
      result = await this.cascadeFallback(trimmed, source.name, context);
    } else if (result.tracks.length > 0 && !isDirectUrl && !isExplicitPrefix) {
      // Relevance Shield: Ensure initial result actually matches the query keywords
      const queryClean = trimmed.toLowerCase().replace(/[^a-z0-9\s]/gi, ' ');
      const queryWords = queryClean
        .split(/\s+/)
        .filter((w) => w.length > 1 && !['the', 'and', 'for', 'from', 'with', 'song', 'audio', 'video'].includes(w));
      if (queryWords.length > 0) {
        const first = result.tracks[0];
        if (first) {
          const targetText = `${first.title} ${first.author || ''}`.toLowerCase();
          const hasMatch = queryWords.some((w) => targetText.includes(w));
          if (!hasMatch) {
            this.logger.warn(
              { query: trimmed, initialTrack: first.title, author: first.author, source: source.name },
              'Initial search result failed keyword relevance check, cascading to next source'
            );
            const fallbackRes = await this.cascadeFallback(trimmed, source.name, context);
            if (fallbackRes.tracks.length > 0) {
              result = fallbackRes;
            }
          }
        }
      }
    }

    const mappedResult: ResolvedResult = {
      type: result.type,
      playlistName: result.playlistName,
      tracks: result.tracks.map((t) => ({
        ...t,
        requesterId,
      })),
    };

    // 5. Cache result if successful and non-empty
    if (!isLocal && mappedResult.tracks.length > 0) {
      if (this.cache.size >= this.MAX_CACHE_ENTRIES) {
        // Prune oldest entry
        const firstKey = this.cache.keys().next().value;
        if (firstKey) this.cache.delete(firstKey);
      }

      this.cache.set(cacheKey, {
        result: mappedResult,
        expiresAt: Date.now() + this.CACHE_TTL_MS,
      });
    }

    return mappedResult;
  }

  private async cascadeFallback(
    query: string,
    triedSource: string,
    context: SourceContext
  ): Promise<ResolvedResult> {
    const searchSequence: Array<{ name: string; prefix: string }> = [
      { name: 'youtube', prefix: 'ytmsearch:' },
      { name: 'spotify', prefix: 'spsearch:' },
      { name: 'soundcloud', prefix: 'scsearch:' },
    ];

    for (const entry of searchSequence) {
      if (entry.name === triedSource) continue;
      const fallbackSource = this.sourceManager.getSource(entry.name);
      if (!fallbackSource) continue;

      this.logger.info(
        { query, fallbackSource: entry.name },
        `Attempting search fallback to ${entry.name}`
      );

      try {
        const fallbackResult = await fallbackSource.resolve(`${entry.prefix}${query}`, context);
        if (fallbackResult.tracks.length > 0) {
          this.logger.info(
            { query, resolvedVia: entry.name, trackCount: fallbackResult.tracks.length },
            `Successfully resolved tracks via fallback to ${entry.name}`
          );
          return fallbackResult;
        }
      } catch (err: any) {
        if (err?.status === 429 || String(err?.message || '').includes('429')) {
          await new Promise((r) => setTimeout(r, 600));
        }
        this.logger.debug(
          { err, fallbackSource: entry.name },
          `Fallback to ${entry.name} failed or produced no tracks`
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    return { type: 'search', tracks: [] };
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
