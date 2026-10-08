import { randomUUID } from 'crypto';
import { LoadType } from 'shoukaku';
import { AudioSource, ResolvedResult, SourceContext } from './AudioSource';
import { Track } from '../music/types/track';
import { SourceError } from '../utils/errors';
import { lavalinkGatekeeper } from '../utils/lavalinkGatekeeper';

export class SoundCloudSource implements AudioSource {
  public readonly name = 'soundcloud';
  public readonly priority = 20;

  private readonly soundcloudRegex =
    /^(https?:\/\/)?(www\.|m\.)?soundcloud\.com\/[a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+/i;

  public supports(input: string): boolean {
    const trimmed = input.trim();
    if (this.soundcloudRegex.test(trimmed)) return true;
    if (trimmed.startsWith('scsearch:')) return true;
    return false;
  }

  public async resolve(input: string, context: SourceContext): Promise<ResolvedResult> {
    const trimmed = input.trim();
    const isUrl = this.soundcloudRegex.test(trimmed);
    const identifier = isUrl
      ? trimmed
      : trimmed.startsWith('scsearch:')
      ? trimmed
      : `scsearch:${trimmed}`;

    if (!context.shoukaku || !context.shoukaku.nodes) {
      throw new SourceError(
        'LAVALINK_UNAVAILABLE',
        'No Lavalink audio nodes available to resolve SoundCloud track',
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
      context.logger.debug({ identifier, node: node.name }, 'Resolving SoundCloud track via Lavalink node');
      try {
        const res = await lavalinkGatekeeper.resolve(node, identifier, 8000);
        if (res && res.loadType !== LoadType.EMPTY && res.loadType !== LoadType.ERROR) {
          response = res;
          break;
        }
      } catch (err: any) {
        context.logger.warn({ err, node: node.name, identifier }, 'Lavalink node resolve failed for SoundCloud, trying next');
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
        const tracks: Track[] = (playlistData.tracks || []).map((t: any) =>
          this.mapToTrack(t, context.requesterId)
        );
        return {
          type: 'playlist',
          tracks,
          playlistName: playlistData.info?.name || 'SoundCloud Playlist',
        };
      }

      case LoadType.SEARCH: {
        const searchList = (response.data as any[]) || [];
        return {
          type: 'search',
          tracks: searchList.map((t) => this.mapToTrack(t, context.requesterId)),
        };
      }

      case LoadType.EMPTY:
        return { type: 'search', tracks: [] };

      case LoadType.ERROR:
      default: {
        const errData = response.data as any;
        context.logger.error({ identifier, error: errData }, 'SoundCloud resolution error from Lavalink');
        throw new SourceError(
          'SOURCE_UNAVAILABLE',
          `SoundCloud track resolution error: ${errData?.message || 'unknown'}`,
          'Could not load audio from SoundCloud.'
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
      source: 'soundcloud',
      thumbnail: info.artworkUrl || undefined,
      requesterId,
      isStream: info.isStream || false,
      metadata: {
        identifier: info.identifier,
      },
    };
  }
}
