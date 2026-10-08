import { describe, it, expect, vi } from 'vitest';
import { SourceManager } from '@/sources/SourceManager';
import { TrackResolver } from '@/music/TrackResolver';
import { MusicService } from '@/services/MusicService';
import { AudioSource, ResolvedResult } from '@/sources/AudioSource';
import { QueueManager } from '@/music/QueueManager';
import { PlaybackController } from '@/music/PlaybackController';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

describe('Integration Pipeline: /play query -> TrackResolver -> SourceManager -> Adapter -> MusicService -> QueueManager', () => {
  it('should resolve track and enqueue into player queue seamlessly', async () => {
    // 1. Setup Source Adapter & Manager
    const sourceManager = new SourceManager();
    const mockAudioSource: AudioSource = {
      name: 'mock',
      priority: 1,
      supports: (input) => input.startsWith('mock:'),
      resolve: vi.fn().mockResolvedValue({
        type: 'track',
        tracks: [
          {
            id: 'mock_track_abc',
            encodedTrack: 'encoded_opus_data',
            title: 'Mock Integration Track',
            author: 'Mock Artist',
            duration: 215000,
            uri: 'https://mocksource.com/track/123',
            source: 'youtube',
            requesterId: 'user_tester',
          },
        ],
      } as ResolvedResult),
    };
    sourceManager.registerSource(mockAudioSource);

    // 2. Setup TrackResolver
    const mockShoukaku: any = {
      getIdealNode: () => ({ rest: { resolve: vi.fn() } }),
    };
    const trackResolver = new TrackResolver(sourceManager, mockShoukaku, silentLogger);

    // 3. Setup GuildPlayer with Queue and PlaybackController
    const queue = new QueueManager();
    const playback = new PlaybackController(silentLogger);
    const mockShoukakuPlayer: any = {
      playTrack: vi.fn().mockResolvedValue(undefined),
      setPaused: vi.fn(),
      stopTrack: vi.fn(),
      setGlobalVolume: vi.fn(),
      seekTo: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn(),
    };

    const mockPlayer: any = {
      guildId: 'guild_100',
      voiceChannelId: 'vc_100',
      textChannelId: 'tc_100',
      queue,
      playback,
      shoukakuPlayer: mockShoukakuPlayer,
      isPlaying: false,
      isPaused: false,
      play: vi.fn().mockImplementation(async () => {
        const next = queue.next();
        if (next) {
          playback.transition('BUFFERING');
          playback.transition('PLAYING');
          return true;
        }
        return false;
      }),
    };

    const mockMusicManager: any = {
      shoukaku: mockShoukaku,
      getPlayer: () => mockPlayer,
      getOrCreatePlayer: vi.fn().mockResolvedValue(mockPlayer),
    };

    // 4. Setup MusicService
    const musicService = new MusicService(mockMusicManager, trackResolver, silentLogger);

    // 5. Execute /play query
    const playResult = await musicService.play({
      guildId: 'guild_100',
      voiceChannelId: 'vc_100',
      textChannelId: 'tc_100',
      query: 'mock:sample-song',
      requesterId: 'user_tester',
    });

    // 6. Assertions
    expect(mockAudioSource.resolve).toHaveBeenCalledTimes(1);
    expect(playResult.type).toBe('track');
    expect(playResult.tracks[0]?.title).toBe('Mock Integration Track');
    expect(playResult.enqueuedPosition).toBe(1);

    // Verify track is in playback / queue
    expect(mockPlayer.play).toHaveBeenCalled();
    expect(playback.state).toBe('PLAYING');
  });
});
