import { randomUUID } from 'crypto';
import { LoadType } from 'shoukaku';
import { AudioSource, ResolvedResult, SourceContext } from './AudioSource';
import { Track } from '../music/types/track';
import { SourceError } from '../utils/errors';
import { config } from '../config/env';
import { lavalinkGatekeeper } from '../utils/lavalinkGatekeeper';

interface SpotifyTrackMeta {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  uri: string;
  thumbnail?: string;
  isrc?: string;
}

export class SpotifySource implements AudioSource {
  public readonly name = 'spotify';
  public readonly priority = 5;

  private readonly spotifyRegex =
    /(?:https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?|spotify:)(track|album|playlist)[:/]([a-zA-Z0-9]+)/i;

  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  public supports(input: string): boolean {
    const trimmed = input.trim();
    if (this.spotifyRegex.test(trimmed)) return true;
    if (trimmed.startsWith('spsearch:') || trimmed.startsWith('spotifysearch:')) return true;
    return false;
  }

  public async resolve(input: string, context: SourceContext): Promise<ResolvedResult> {
    const trimmed = input.trim();
    const isUrl = this.spotifyRegex.test(trimmed);
    const identifier = isUrl
      ? trimmed
      : trimmed.startsWith('spsearch:') || trimmed.startsWith('spotifysearch:')
      ? trimmed
      : `spsearch:${trimmed}`;

    // 1. First attempt native Lavalink resolution across available nodes (prefer nodes with active Spotify REST like Millo-Node)
    if (context.shoukaku && context.shoukaku.nodes) {
      const allNodes = Array.from(context.shoukaku.nodes.values());
      const candidateNodes = allNodes.sort((a, b) => {
        if (a.name === 'Millo-Node') return -1;
        if (b.name === 'Millo-Node') return 1;
        return 0;
      });

      for (const node of candidateNodes) {
        if (!node.rest || node.state !== 1) continue;
        context.logger.debug({ identifier, node: node.name }, 'Attempting native Lavalink resolution for Spotify');
        try {
          const response = await lavalinkGatekeeper.resolve(node, identifier, 6000);

          if (response) {
            if (response.loadType === LoadType.TRACK && response.data) {
              const raw = response.data as any;
              return {
                type: 'track',
                tracks: [this.mapLavalinkTrack(raw, context.requesterId)],
              };
            } else if (response.loadType === LoadType.PLAYLIST && response.data) {
              const playlistData = response.data as any;
              const rawTracks = (playlistData.tracks || []) as any[];
              return {
                type: 'playlist',
                tracks: rawTracks.map((raw) => this.mapLavalinkTrack(raw, context.requesterId)),
                playlistName: playlistData.info?.name || 'Spotify Playlist',
              };
            } else if (response.loadType === LoadType.SEARCH && response.data) {
              const rawTracks = (Array.isArray(response.data) ? response.data : (response.data as any)?.tracks || []) as any[];
              if (rawTracks.length > 0) {
                return {
                  type: 'search',
                  tracks: rawTracks.map((raw) => this.mapLavalinkTrack(raw, context.requesterId)),
                };
              }
            }
          }
        } catch (nodeErr: any) {
          context.logger.warn({ err: nodeErr, node: node.name, identifier }, 'Lavalink node Spotify resolve failed, trying next candidate');
        }
      }
    }

    // 2. If native resolution yielded no tracks and input is a Spotify URL, attempt Web API resolution
    if (isUrl) {
      return this.resolveViaWebApi(trimmed, context);
    }

    // 3. For plain search queries with no tracks returned, return empty search result so TrackResolver can cascade
    return { type: 'search', tracks: [] };
  }

  private async resolveViaWebApi(input: string, context: SourceContext): Promise<ResolvedResult> {
    const match = input.trim().match(this.spotifyRegex);
    if (!match || !match[1] || !match[2]) {
      throw new SourceError(
        'INVALID_SOURCE_URL',
        `Invalid Spotify URL or URI: ${input}`,
        'Invalid Spotify URL provided.'
      );
    }

    const type = match[1].toLowerCase() as 'track' | 'album' | 'playlist';
    const id = match[2];

    context.logger.info({ type, id }, 'Resolving Spotify resource metadata');

    // 1. Ensure valid access token
    const token = await this.getAccessToken();

    // 2. Fetch resource metadata from Spotify Web API
    let tracksMeta: SpotifyTrackMeta[] = [];
    let playlistName: string | undefined;

    try {
      if (type === 'track') {
        const trackMeta = await this.fetchTrack(id, token, context);
        tracksMeta = [trackMeta];
      } else if (type === 'album') {
        const albumData = await this.fetchAlbum(id, token, context);
        tracksMeta = albumData.tracks;
        playlistName = albumData.name;
      } else if (type === 'playlist') {
        const playlistData = await this.fetchPlaylist(id, token, context);
        tracksMeta = playlistData.tracks;
        playlistName = playlistData.name;
      }
    } catch (err) {
      if (err instanceof SourceError) throw err;
      throw new SourceError(
        'SOURCE_UNAVAILABLE',
        `Failed to fetch Spotify metadata: ${err instanceof Error ? err.message : String(err)}`,
        'Failed to fetch track metadata from Spotify.'
      );
    }

    if (tracksMeta.length === 0) {
      throw new SourceError(
        'TRACK_NOT_FOUND',
        `Spotify ${type} contains no tracks or is inaccessible`,
        'No playable tracks found in that Spotify link.'
      );
    }

    // 3. Resolve metadata to playable audio via Lavalink / fallbackResolver
    if (!context.fallbackResolver) {
      throw new SourceError(
        'SOURCE_UNAVAILABLE',
        'No fallback audio resolver configured for Spotify track resolution',
        'Unable to resolve audio for Spotify tracks.'
      );
    }

    context.logger.info(
      { trackCount: tracksMeta.length, type },
      'Resolving Spotify metadata to playable audio streams'
    );

    const resolvedTracks: Track[] = [];
    const limit = Math.min(tracksMeta.length, 25);
    const targetMeta = tracksMeta.slice(0, limit);

    const resolveItem = async (meta: SpotifyTrackMeta): Promise<Track | null> => {
      try {
        const cleanTitle = meta.title
          .replace(/["'()[\]{}]/g, ' ')
          .replace(/[\-–—]\s*(From|Remix|Official|Audio|Bonus|Live|Video).*$/i, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const cleanArtist = (meta.artist || '').replace(/["'()[\]{}]/g, ' ').split(',')[0]?.trim() || 'Artist';
        const searchQuery = meta.isrc
          ? `ytmsearch:${cleanTitle} ${cleanArtist}`
          : `ytmsearch:${cleanTitle} ${cleanArtist}`;

        if (!context.fallbackResolver) return null;
        const searchPromise = context.fallbackResolver(searchQuery, context.requesterId);
        const timeoutPromise = new Promise<any>((_, reject) =>
          setTimeout(() => reject(new Error('Track resolution timeout')), 5000)
        );
        const searchResult = await Promise.race([searchPromise, timeoutPromise]);
        const filterCandidate = (t: Track): boolean => {
          const tTitle = (t.title || '').toLowerCase();
          if (meta.durationMs > 60000 && t.duration <= 35000) return false;
          const allowSpeed = /\b(slowed|reverb|sped\s*up|speed\s*up|nightcore)\b/i.test(meta.title);
          if (!allowSpeed && /\b(slowed|reverb|sped\s*up|speed\s*up|nightcore|daycore|chopped|karaoke)\b/i.test(tTitle)) {
            return false;
          }
          if (meta.durationMs > 30000 && t.duration > 0) {
            if (Math.abs(t.duration - meta.durationMs) > 45000) return false;
          }
          return true;
        };

        const validCandidates = (searchResult?.tracks || []).filter(filterCandidate);
        let bestMatch = validCandidates[0] || searchResult?.tracks?.[0];
        if (!bestMatch && context.fallbackResolver) {
          try {
            const ytFallbackResult = await Promise.race([
              context.fallbackResolver(`ytsearch:${cleanTitle} ${cleanArtist} official audio`, context.requesterId),
              new Promise<any>((_, reject) => setTimeout(() => reject(new Error('YT fallback resolution timeout')), 4000)),
            ]);
            const validYt = (ytFallbackResult?.tracks || []).filter(filterCandidate);
            bestMatch = validYt[0] || ytFallbackResult?.tracks?.[0];
          } catch {
            // Ignore fallback failure
          }
        }

        if (bestMatch) {
          return {
            ...bestMatch,
            title: meta.title,
            author: meta.artist,
            album: meta.album || bestMatch.album,
            duration: meta.durationMs || bestMatch.duration,
            thumbnail: meta.thumbnail || bestMatch.thumbnail,
            uri: meta.uri,
            source: 'spotify',
            metadata: {
              ...bestMatch.metadata,
              spotifyId: meta.id,
              isrc: meta.isrc,
            },
          };
        }
      } catch (err) {
        context.logger.debug({ err, track: meta.title }, 'Fallback resolution failed for Spotify track');
      }
      return null;
    };

    const BATCH_SIZE = 4;
    for (let i = 0; i < targetMeta.length; i += BATCH_SIZE) {
      const batch = targetMeta.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(resolveItem));
      for (const res of results) {
        if (res) resolvedTracks.push(res);
      }
    }

    if (resolvedTracks.length === 0) {
      throw new SourceError(
        'TRACK_NOT_FOUND',
        'Could not find any playable audio streams for the Spotify track(s)',
        'No playable audio could be matched for the requested Spotify track(s).'
      );
    }

    return {
      type: type === 'track' ? 'track' : 'playlist',
      tracks: resolvedTracks,
      playlistName: playlistName || (type === 'track' ? undefined : 'Spotify Collection'),
    };
  }

  private mapLavalinkTrack(raw: any, requesterId: string): Track {
    const info = raw.info || {};
    return {
      id: randomUUID(),
      encodedTrack: raw.encoded,
      title: info.title || 'Unknown Title',
      author: info.author || 'Unknown Artist',
      duration: info.length || 0,
      uri: info.uri || '',
      source: 'spotify',
      thumbnail: info.artworkUrl || undefined,
      requesterId,
      isStream: info.isStream || false,
      metadata: {
        identifier: info.identifier,
        isrc: info.isrc,
      },
    };
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const clientId = config.SPOTIFY_CLIENT_ID;
    const clientSecret = config.SPOTIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new SourceError(
        'SOURCE_AUTH_FAILED',
        'Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in environment',
        'Spotify integration is not configured. Please provide Spotify API credentials.'
      );
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new SourceError(
          'SOURCE_AUTH_FAILED',
          `Spotify token request failed with status: ${response.status}`,
          'Spotify authentication failed. Please verify bot credentials.'
        );
      }

      const data = (await response.json()) as { access_token: string; expires_in: number };
      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
      return this.accessToken;
    } catch (err: unknown) {
      if (err instanceof SourceError) throw err;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new SourceError(
        isAbort ? 'SOURCE_TIMEOUT' : 'SOURCE_AUTH_FAILED',
        `Spotify auth error: ${err instanceof Error ? err.message : String(err)}`,
        'Spotify service is temporarily unreachable.'
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchTrack(id: string, token: string, context: SourceContext): Promise<SpotifyTrackMeta> {
    const data = await this.fetchSpotifyApi(`https://api.spotify.com/v1/tracks/${id}`, token, context);
    return this.mapTrackObject(data);
  }

  private async fetchAlbum(
    id: string,
    token: string,
    context: SourceContext
  ): Promise<{ name: string; tracks: SpotifyTrackMeta[] }> {
    const data = await this.fetchSpotifyApi(`https://api.spotify.com/v1/albums/${id}`, token, context);
    const albumName = data.name || 'Unknown Album';
    const albumArt = data.images?.[0]?.url;

    const tracks: SpotifyTrackMeta[] = (data.tracks?.items || []).map((t: any) => ({
      ...this.mapTrackObject(t),
      album: albumName,
      thumbnail: albumArt,
    }));

    return { name: albumName, tracks };
  }

  private async fetchPlaylist(
    id: string,
    token: string,
    context: SourceContext
  ): Promise<{ name: string; tracks: SpotifyTrackMeta[] }> {
    try {
      const data = await this.fetchSpotifyApi(
        `https://api.spotify.com/v1/playlists/${id}?fields=name,images,tracks.items(track(id,name,artists,album(name,images),duration_ms,external_urls,external_ids))`,
        token,
        context
      );

      const playlistName = data.name || 'Spotify Playlist';
      const playlistTracks: SpotifyTrackMeta[] = [];

      for (const item of data.tracks?.items || []) {
        if (item.track && item.track.id) {
          playlistTracks.push(this.mapTrackObject(item.track));
        }
      }

      if (playlistTracks.length > 0) {
        return { name: playlistName, tracks: playlistTracks };
      }
    } catch (err) {
      context.logger.warn({ err, id }, 'Spotify API playlist resolution failed, attempting public HTML fallback');
    }

    return this.fetchPlaylistFromHtml(id, context);
  }

  private async fetchPlaylistFromHtml(
    id: string,
    context: SourceContext
  ): Promise<{ name: string; tracks: SpotifyTrackMeta[] }> {
    try {
      const res = await fetch(`https://open.spotify.com/playlist/${id}`);
      if (res.ok) {
        const html = await res.text();
        const match = html.match(/<script id="initialState"[^>]*>([^<]+)<\/script>/);
        if (match && match[1]) {
          const json = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
          const entity = (json.entities?.items?.[`spotify:playlist:${id}`] ||
            Object.values(json.entities?.items || {})[0]) as any;

          const playlistName = entity?.name || 'Spotify Playlist';
          const playlistTracks: SpotifyTrackMeta[] = [];

          const rawItems = (entity?.content?.items || entity?.trackList || []) as any[];
          for (const item of rawItems) {
            const t = item.itemV2?.data || item;
            if (t && t.name) {
              const artists = (t.artists?.items || t.artists || [])
                .map((a: any) => a.profile?.name || a.name)
                .filter(Boolean)
                .join(', ') || 'Unknown Artist';

              playlistTracks.push({
                id: t.id || t.uri?.split(':')?.[2] || randomUUID(),
                title: t.name,
                artist: artists,
                album: t.albumOfTrack?.name || t.album?.name,
                durationMs: t.duration?.totalMilliseconds || t.duration_ms || 0,
                uri: t.uri || `spotify:track:${t.id || ''}`,
                thumbnail: t.albumOfTrack?.coverArt?.sources?.[0]?.url || t.album?.images?.[0]?.url,
              });
            }
          }

          if (playlistTracks.length > 0) {
            context.logger.info(
              { playlistName, trackCount: playlistTracks.length },
              'Successfully extracted Spotify playlist via public HTML fallback'
            );
            return { name: playlistName, tracks: playlistTracks };
          }
        }
      }
    } catch (htmlErr) {
      context.logger.warn({ htmlErr, id }, 'Spotify HTML fallback failed');
    }

    throw new SourceError(
      'SOURCE_UNAVAILABLE',
      `Failed to fetch Spotify playlist metadata for id: ${id}`,
      'Spotify could not load this playlist.'
    );
  }

  private async fetchSpotifyApi(url: string, token: string, context: SourceContext): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
        context.logger.warn({ retryAfter }, 'Spotify API rate limit hit');
        throw new SourceError(
          'SOURCE_RATE_LIMITED',
          `Spotify rate limit hit. Retry after ${retryAfter}s`,
          `Spotify API is currently rate-limited. Please try again in ${retryAfter}s.`
        );
      }

      if (res.status === 404) {
        throw new SourceError(
          'TRACK_NOT_FOUND',
          `Spotify resource not found: ${url}`,
          'That Spotify track, album, or playlist does not exist or is private.'
        );
      }

      if (!res.ok) {
        throw new SourceError(
          'SOURCE_UNAVAILABLE',
          `Spotify API returned error code ${res.status}`,
          'Spotify API returned an error.'
        );
      }

      return await res.json();
    } catch (err) {
      if (err instanceof SourceError) throw err;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new SourceError(
        isAbort ? 'SOURCE_TIMEOUT' : 'SOURCE_UNAVAILABLE',
        `Spotify API call failed: ${err instanceof Error ? err.message : String(err)}`,
        'Could not contact Spotify servers.'
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private mapTrackObject(item: any): SpotifyTrackMeta {
    const artists = (item.artists || []).map((a: any) => a.name).join(', ') || 'Unknown Artist';
    const thumbnail = item.album?.images?.[0]?.url || undefined;
    const isrc = item.external_ids?.isrc || undefined;

    return {
      id: item.id || '',
      title: item.name || 'Unknown Title',
      artist: artists,
      album: item.album?.name,
      durationMs: item.duration_ms || 0,
      uri: item.external_urls?.spotify || `https://open.spotify.com/track/${item.id}`,
      thumbnail,
      isrc,
    };
  }
}
