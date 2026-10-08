import { MusicManager } from '../music/MusicManager';
import { TrackResolver } from '../music/TrackResolver';
import { GuildPlayer } from '../music/GuildPlayer';
import { Track } from '../music/types/track';
import { PlaybackStatus } from '../music/types/playback';
import { PaginatedQueue } from '../music/QueueManager';
import { VoidTuneError, SourceError } from '../utils/errors';
import { Logger } from 'pino';

export interface PlayResult {
  type: 'track' | 'playlist' | 'search';
  tracks: Track[];
  playlistName?: string;
  enqueuedPosition: number;
  startedImmediately?: boolean;
}

export class MusicService {
  private readonly musicManager: MusicManager;
  private readonly trackResolver: TrackResolver;
  private readonly logger: Logger;

  constructor(musicManager: MusicManager, trackResolver: TrackResolver, logger: Logger) {
    this.musicManager = musicManager;
    this.trackResolver = trackResolver;
    this.logger = logger.child({ module: 'MusicService' });
  }

  public getPlayer(guildId: string): GuildPlayer | undefined {
    return this.musicManager.getPlayer(guildId);
  }

  public async join(guildId: string, voiceChannelId: string, textChannelId: string): Promise<GuildPlayer> {
    return this.musicManager.getOrCreatePlayer({
      guildId,
      voiceChannelId,
      textChannelId,
    });
  }

  public async leave(guildId: string): Promise<void> {
    await this.musicManager.destroyPlayer(guildId);
  }

  public async play(options: {
    guildId: string;
    voiceChannelId: string;
    textChannelId: string;
    query: string;
    requesterId: string;
  }): Promise<PlayResult> {
    const player = await this.join(options.guildId, options.voiceChannelId, options.textChannelId);
    const resolved = await this.resolveTracks(options.query, options.requesterId);

    if (resolved.tracks.length === 0) {
      throw new SourceError('TRACK_NOT_FOUND', 'No matching tracks found for the query', 'No tracks could be found for that query.');
    }

    const currentQueueSize = player.queue.size;
    const firstTrack = resolved.tracks[0];
    if (!firstTrack) {
      throw new SourceError('TRACK_NOT_FOUND', 'No matching tracks found for the query', 'No tracks could be found for that query.');
    }
    const tracksToEnqueue: Track[] = resolved.type === 'playlist' ? resolved.tracks : [firstTrack];
    player.queue.add(tracksToEnqueue);

    this.logger.info(
      { guildId: options.guildId, trackCount: tracksToEnqueue.length, enqueuedPosition: currentQueueSize + 1 },
      'Enqueued resolved tracks for guild session'
    );

    const wasIdle = !player.isPlaying && !player.isPaused;

    // If currently idle, start playback immediately
    if (wasIdle) {
      await player.play();
    }

    return {
      type: resolved.type,
      tracks: tracksToEnqueue,
      playlistName: resolved.playlistName,
      enqueuedPosition: currentQueueSize + 1,
      startedImmediately: wasIdle,
    };
  }

  public async pause(guildId: string): Promise<void> {
    const player = this.musicManager.getPlayer(guildId);
    if (!player || (!player.isPlaying && !player.isPaused)) {
      throw new VoidTuneError({
        code: 'PLAYER_ERROR',
        message: 'No active player in guild',
        userMessage: 'There is no active music playback to pause.',
      });
    }
    await player.pause();
  }

  public async resume(guildId: string): Promise<void> {
    const player = this.musicManager.getPlayer(guildId);
    if (!player || !player.isPaused) {
      throw new VoidTuneError({
        code: 'PLAYER_ERROR',
        message: 'Player is not paused',
        userMessage: 'Playback is not paused.',
      });
    }
    await player.resume();
  }

  public async skip(guildId: string): Promise<Track | null> {
    const player = this.musicManager.getPlayer(guildId);
    if (!player || (!player.isPlaying && !player.isPaused)) {
      throw new VoidTuneError({
        code: 'PLAYER_ERROR',
        message: 'No active track to skip',
        userMessage: 'There is no track currently playing to skip.',
      });
    }
    return player.skip();
  }

  public async previous(guildId: string): Promise<Track | null> {
    const player = this.musicManager.getPlayer(guildId);
    if (!player) {
      throw new VoidTuneError({
        code: 'PLAYER_ERROR',
        message: 'No active player in guild',
        userMessage: 'There is no active music player in this server.',
      });
    }
    return player.previous();
  }

  public async stop(guildId: string): Promise<Track | null> {
    const player = this.musicManager.getPlayer(guildId);
    if (!player) {
      throw new VoidTuneError({
        code: 'PLAYER_ERROR',
        message: 'No active player to stop',
        userMessage: 'There is no active music player in this server.',
      });
    }
    const currentTrack = player.currentTrack;
    await player.stop();
    return currentTrack;
  }

  public async setVolume(guildId: string, volume: number): Promise<number> {
    const player = this.musicManager.getPlayer(guildId);
    if (!player) {
      throw new VoidTuneError({
        code: 'PLAYER_ERROR',
        message: 'No player to adjust volume',
        userMessage: 'There is no active music player to adjust volume for.',
      });
    }
    await player.setVolume(volume);
    return player.volume;
  }

  public async seek(guildId: string, positionMs: number): Promise<void> {
    const player = this.musicManager.getPlayer(guildId);
    if (!player || !player.currentTrack) {
      throw new VoidTuneError({
        code: 'PLAYER_ERROR',
        message: 'No active track to seek',
        userMessage: 'There is no track currently playing.',
      });
    }
    await player.seek(positionMs);
  }

  public getNowPlaying(guildId: string): PlaybackStatus | null {
    const player = this.musicManager.getPlayer(guildId);
    if (!player || !player.currentTrack) {
      return null;
    }
    return player.getStatus();
  }

  public getQueue(guildId: string, page = 1, pageSize = 10): PaginatedQueue | null {
    const player = this.musicManager.getPlayer(guildId);
    if (!player) {
      return null;
    }
    return player.queue.getPaginated(page, pageSize);
  }

  public getAllPlayers(): GuildPlayer[] {
    return this.musicManager.getAllPlayers();
  }

  public async resolveTracks(
    rawQuery: string,
    requesterId: string
  ): Promise<{ type: 'track' | 'playlist' | 'search'; tracks: Track[]; playlistName?: string }> {
    return this.trackResolver.resolve(rawQuery, requesterId);
  }
}
