import { randomUUID } from 'crypto';
import { LoadType } from 'shoukaku';
import { AudioSource, ResolvedResult, SourceContext } from './AudioSource';
import { Track } from '../music/types/track';
import { SourceError } from '../utils/errors';
import { lavalinkGatekeeper } from '../utils/lavalinkGatekeeper';

export class YouTubeSource implements AudioSource {
  public readonly name = 'youtube';
  public readonly priority = 10;

  private readonly youtubeRegex =
    /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com\/(watch\?v=|playlist\?list=|shorts\/)|youtu\.be\/)/i;

  public supports(input: string): boolean {
    const trimmed = input.trim();
    if (this.youtubeRegex.test(trimmed)) return true;
    if (trimmed.startsWith('ytsearch:') || trimmed.startsWith('ytmsearch:')) return true;
    return false;
  }

  public async resolve(input: string, context: SourceContext): Promise<ResolvedResult> {
    const trimmed = input.trim();
    const isUrl = this.youtubeRegex.test(trimmed);
    const identifier = isUrl
      ? trimmed
      : trimmed.startsWith('ytsearch:') || trimmed.startsWith('ytmsearch:')
      ? trimmed
      : `ytmsearch:${trimmed}`;

    if (!context.shoukaku || !context.shoukaku.nodes) {
      throw new SourceError(
        'LAVALINK_UNAVAILABLE',
        'No Lavalink audio nodes available to resolve YouTube track',
        'Audio processing node is currently unavailable.'
      );
    }

    const idealNode = typeof context.shoukaku.getIdealNode === 'function' ? context.shoukaku.getIdealNode() : null;
    const allNodes = Array.from(context.shoukaku.nodes.values());
    const candidateNodes = idealNode
      ? [idealNode, ...allNodes.filter((n) => n.name !== idealNode.name)]
      : allNodes;

    let response: any = null;
    for (const node of candidateNodes) {
      if (!node.rest || node.state !== 1) continue;
      context.logger.debug({ identifier, node: node.name }, 'Resolving YouTube track via Lavalink node');
      try {
        const res = await lavalinkGatekeeper.resolve(node, identifier, 8000);
        if (res && res.loadType !== LoadType.EMPTY && res.loadType !== LoadType.ERROR) {
          response = res;
          break;
        }
      } catch (err: any) {
        context.logger.warn({ err, node: node.name, identifier }, 'Lavalink node resolve failed for YouTube, trying next');
      }
    }

    // Fallback: If a YouTube URL with a playlist failed (e.g. private or unplayable playlist)
    // but contains a video ID, attempt resolving the single video so playback succeeds.
    if (!response && isUrl) {
      const match = trimmed.match(/(?:[?&]v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (match && /[?&]list=/i.test(trimmed)) {
        const videoOnlyUrl = `https://www.youtube.com/watch?v=${match[1]}`;
        context.logger.info(
          { original: trimmed, fallbackVideo: videoOnlyUrl },
          'Playlist resolution failed; attempting fallback to single video ID'
        );
        for (const node of candidateNodes) {
          if (!node.rest || node.state !== 1) continue;
          try {
            const res = await lavalinkGatekeeper.resolve(node, videoOnlyUrl, 8000);
            if (res && res.loadType !== LoadType.EMPTY && res.loadType !== LoadType.ERROR) {
              response = res;
              break;
            }
          } catch (err: any) {
            context.logger.warn({ err, node: node.name, videoOnlyUrl }, 'Fallback video resolve failed');
          }
        }
      }
    }

    if (!response) {
      return { type: 'search', tracks: [] };
    }

    switch (response.loadType) {
      case LoadType.TRACK: {
        const raw = response.data as any;
        return {
          type: 'track',
          tracks: [this.mapToTrack(raw, context.requesterId)],
        };
      }

      case LoadType.PLAYLIST: {
        const playlistData = response.data as any;
        const rawTracks = (playlistData.tracks || []) as any[];
        const tracks = rawTracks.map((raw) => this.mapToTrack(raw, context.requesterId));

        return {
          type: 'playlist',
          tracks,
          playlistName: playlistData.info?.name || 'YouTube Playlist',
        };
      }

      case LoadType.SEARCH: {
        const rawTracks = (response.data || []) as any[];
        const queryLower = trimmed.toLowerCase();
        const allowSpeedMod = /\b(slowed|reverb|sped\s*up|speed\s*up|nightcore)\b/i.test(queryLower);
        const allowCover = /\b(cover|karaoke|acoustic)\b/i.test(queryLower);
        const allowLong = /\b(hour|loop|album|mix|compilation)\b/i.test(queryLower);

        const rawQuery = trimmed.replace(/^(ytmsearch:|ytsearch:)/i, '').trim();
        const cleanQuery = rawQuery
          .toLowerCase()
          .replace(/["'()[\]{}]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const queryWords = cleanQuery
          .replace(/[^a-z0-9\s]/gi, ' ')
          .split(/\s+/)
          .filter((w) => w.length > 1 && !['the', 'and', 'for', 'from', 'with', 'song', 'track', 'audio', 'video', 'lyrics', 'official', 'by', 'in', 'of', 'full'].includes(w));

        const scoreTrack = (t: any): number => {
          const title = (t.info?.title || '').toLowerCase();
          const author = (t.info?.author || '').toLowerCase();
          const length = t.info?.length || 0;

          // 1. REJECT SHORT PREVIEWS / SNIPPETS IMMEDIATELY
          if (length <= 35000) return -999;

          let score = 100;

          // 2. Exact Title Match Bonus (+180)
          const cleanTitleLower = title
            .replace(/\s*[([{\-].*$/, '')
            .replace(/\b(lyrics|official|hd|video|4k|remastered|audio|mix)\b/gi, '')
            .trim();
          if (cleanTitleLower === cleanQuery) {
            score += 180;
          } else if (cleanTitleLower.startsWith(cleanQuery) || cleanTitleLower.endsWith(cleanQuery)) {
            score += 90;
          }

          // 3. Keyword Relevance Matching
          let matchedTitleWords = 0;
          let matchedAuthorWords = 0;
          for (const w of queryWords) {
            if (title.includes(w)) matchedTitleWords++;
            if (author.includes(w)) matchedAuthorWords++;
          }

          if (queryWords.length > 0) {
            score += Math.round((matchedTitleWords / queryWords.length) * 100);
            score += Math.round((matchedAuthorWords / queryWords.length) * 50);

            // Anti-Mismatch Shield: If NONE of the query keywords appear anywhere in title or author
            if (matchedTitleWords === 0 && matchedAuthorWords === 0) {
              score -= 300;
            }
          }

          // 4. Official Studio Master & Topic Channel Bonus
          if (author.includes('topic') || author.includes('records') || author.includes('vevo') || author.includes('sony') || author.includes('t-series') || author.includes('zee') || author.includes('yrf')) {
            score += 50;
          }
          if (title.includes('official audio') || title.includes('official video') || title.includes('original')) {
            score += 30;
          }

          // 5. Negative Modifiers: Speed mods, amateur covers, podcasts, bloated compilations
          if (!allowSpeedMod && /\b(slowed|reverb|sped\s*up|speed\s*up|nightcore|daycore|chopped|pitch|8d\s*audio|jhankar)\b/i.test(title)) {
            score -= 150;
          }
          if (!allowCover && /\b(cover|karaoke|instrumental|reaction|review|tutorial|parody)\b/i.test(title)) {
            score -= 100;
          }
          if (!allowLong && length > 900000) {
            score -= 100;
          }

          return score;
        };

        const sortedRawTracks = [...rawTracks].sort((a, b) => scoreTrack(b) - scoreTrack(a));
        const filteredTracks = sortedRawTracks.filter((t) => scoreTrack(t) > 0);
        const candidatePool = filteredTracks.length > 0 ? filteredTracks : sortedRawTracks;
        const tracks = candidatePool.map((raw) => this.mapToTrack(raw, context.requesterId));
        return {
          type: 'search',
          tracks,
        };
      }

      case LoadType.EMPTY:
        return { type: 'search', tracks: [] };

      case LoadType.ERROR:
      default: {
        const errData = response.data as any;
        context.logger.error({ identifier, error: errData }, 'YouTube resolution error from Lavalink');
        throw new SourceError(
          'SOURCE_UNAVAILABLE',
          `YouTube track resolution error: ${errData?.message || 'unknown'}`,
          'Could not load audio from YouTube.'
        );
      }
    }
  }

  private mapToTrack(raw: any, requesterId: string): Track {
    const info = raw.info || {};
    return {
      id: randomUUID(),
      encodedTrack: raw.encoded,
      title: info.title || 'Unknown Title',
      author: info.author || 'Unknown Artist',
      duration: info.length || 0,
      uri: info.uri || '',
      source: 'youtube',
      thumbnail: info.artworkUrl || undefined,
      requesterId,
      isStream: info.isStream || false,
      metadata: {
        identifier: info.identifier,
        isrc: info.isrc,
      },
    };
  }
}
