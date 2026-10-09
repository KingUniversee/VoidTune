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
      : `ytsearch:${trimmed}`;

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
        const rawQuery = trimmed.replace(/^(ytmsearch:|ytsearch:)/i, '').trim();
        const queryLower = rawQuery.toLowerCase();
        const allowSpeedMod = /\b(slowed|reverb|sped\s*up|speed\s*up|nightcore|lofi|lo-fi)\b/i.test(queryLower);
        const allowCover = /\b(cover|karaoke|acoustic)\b/i.test(queryLower);
        const allowStatus = /\bstatus\b/i.test(queryLower);
        const allowRegional = /\b(tamil|telugu|malayalam|kannada|bhojpuri)\b/i.test(queryLower);

        const OFFICIAL_CHANNELS = [
          't-series', 'tseries', 'sony music', 'zee music', 'yrf', 'tips official', 'tips music',
          'saregama', 'speed records', 'white hill', 'eros now', 'aditya music', 'geet mp3', 'desi music factory'
        ];

        const scoreTrack = (t: any, index: number): number => {
          const title = (t.info?.title || '').toLowerCase();
          const author = (t.info?.author || '').toLowerCase();
          const length = t.info?.length || 0;

          // 1. REJECT SHORT PREVIEWS / SNIPPETS (< 60s)
          if (length < 60000 && !/short/i.test(queryLower)) return -999;

          // 2. REJECT 30s WHATSAPP STATUS CLIPS
          if (!allowStatus && (/\bstatus\b/i.test(title) || length < 75000)) return -999;

          // 3. REJECT ALTERED AUDIO (slowed, reverb, lofi, nightcore, 8d audio, bass boosted) UNLESS REQUESTED
          if (!allowSpeedMod && /\b(slowed|reverb|sped\s*up|speed\s*up|nightcore|daycore|chopped|pitch|8d\s*audio|jhankar|lofi|lo-fi)\b/i.test(title)) {
            return -999;
          }

          // 4. REJECT AMATEUR COVERS / KARAOKE / REACTIONS UNLESS REQUESTED
          if (!allowCover && /\b(karaoke|instrumental|reaction|review|tutorial|parody|female\s*version|male\s*version\s*cover)\b/i.test(title)) {
            return -999;
          }

          // 5. REGIONAL FILTER: Block Tamil/Telugu/Bhojpuri dubbed audio unless requested
          if (!allowRegional && /\b(tamil|telugu|malayalam|kannada|bhojpuri)\b/i.test(title)) {
            return -999;
          }

          // Base score preserves YouTube's native relevancy ranking
          let score = Math.max(0, 100 - index * 15);

          // Official Record Labels HUGE BOOST (+150)
          const isOfficial = OFFICIAL_CHANNELS.some((ch) => author.includes(ch) || title.includes(ch));
          if (isOfficial) {
            score += 150;
          }
          if (author.includes('topic') || author.includes('vevo')) {
            score += 80;
          }
          if (title.includes('official video') || title.includes('official audio') || title.includes('original')) {
            score += 50;
          }

          // Query keyword matching bonus
          const queryClean = queryLower.replace(/[^a-z0-9\s]/g, ' ');
          const words = queryClean.split(/\s+/).filter((w) => w.length > 2);
          for (const w of words) {
            if (title.includes(w)) score += 20;
            if (author.includes(w)) score += 25;
          }

          return score;
        };

        const scoredTracks = rawTracks.map((t, idx) => ({ track: t, s: scoreTrack(t, idx), idx }));
        const validTracks = scoredTracks.filter((item) => item.s > 0).sort((a, b) => b.s - a.s);
        const candidatePool = validTracks.length > 0 ? validTracks.map((i) => i.track) : rawTracks;
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
