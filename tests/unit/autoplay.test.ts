import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GuildPlayer } from '@/music/GuildPlayer';
import { MusicService } from '@/services/MusicService';
import { Track } from '@/music/types/track';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

describe('Autoplay and Single Track Enqueueing', () => {
  let mockShoukakuPlayer: any;
  let player: GuildPlayer;

  beforeEach(() => {
    mockShoukakuPlayer = {
      position: 0,
      playTrack: vi.fn().mockResolvedValue(undefined),
      stopTrack: vi.fn().mockResolvedValue(undefined),
      setPaused: vi.fn().mockResolvedValue(undefined),
      setGlobalVolume: vi.fn().mockResolvedValue(undefined),
      seekTo: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      node: {
        rest: {
          resolve: vi.fn(),
        },
      },
    };

    player = new GuildPlayer({
      guildId: 'test_guild',
      voiceChannelId: 'test_vc',
      textChannelId: 'test_tc',
      shoukakuPlayer: mockShoukakuPlayer,
      logger: silentLogger,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should stop playback and not play anything when skip is called with empty queue and autoplay off', async () => {
    player.autoplay = false;
    const currentTrack: Track = {
      id: '1',
      encodedTrack: 'enc1',
      title: 'Golden Brown',
      author: 'The Stranglers',
      duration: 200000,
      uri: 'https://spotify.com/1',
      source: 'spotify',
      requesterId: 'user1',
    };

    player.queue.setCurrent(currentTrack);
    expect(player.queue.isEmpty).toBe(true);

    const skipped = await player.skip();

    expect(skipped).toBe(currentTrack);
    expect(player.playback.state).toBe('IDLE');
    expect(player.currentTrack).toBeNull();
    expect(mockShoukakuPlayer.stopTrack).toHaveBeenCalled();
    expect(mockShoukakuPlayer.playTrack).not.toHaveBeenCalled();
  });

  it('should filter out the seed track and its variations in fetchAutoplayRecommendation', async () => {
    const seedTrack: Track = {
      id: 'seed-1',
      encodedTrack: 'enc-seed',
      title: 'Golden Brown',
      author: 'The Stranglers',
      duration: 200000,
      uri: 'https://spotify.com/seed',
      source: 'spotify',
      requesterId: 'user1',
    };

    player.queue.setCurrent(seedTrack);

    // Mock resolve returning: original, slowed version, and a distinct hit
    mockShoukakuPlayer.node.rest.resolve.mockResolvedValue({
      data: [
        {
          encoded: 'enc-same',
          info: { title: 'Golden Brown', author: 'The Stranglers', uri: 'https://spotify.com/same' },
        },
        {
          encoded: 'enc-slowed',
          info: { title: 'Golden Brown - Slowed', author: 'UltraMery', uri: 'https://spotify.com/slowed' },
        },
        {
          encoded: 'enc-distinct',
          info: { title: 'Peaches', author: 'The Stranglers', uri: 'https://spotify.com/peaches' },
        },
      ],
    });

    const recommended = await player.fetchAutoplayRecommendation();

    expect(recommended).not.toBeNull();
    expect(recommended?.title).toBe('Peaches');
    expect(recommended?.title).not.toContain('Golden Brown');
    expect(recommended?.requesterId).toBe('Autoplay');
  });

  it('should only enqueue the 1 best match when MusicService resolves a search query', async () => {
    const mockMusicManager: any = {
      getOrCreatePlayer: vi.fn().mockResolvedValue(player),
      getPlayer: vi.fn().mockReturnValue(player),
    };

    const mockTrackResolver: any = {
      resolve: vi.fn().mockResolvedValue({
        type: 'search',
        tracks: [
          { id: '1', title: 'Song 1', author: 'Artist', encodedTrack: 'e1', duration: 100, uri: 'u1', source: 'spotify', requesterId: 'u' },
          { id: '2', title: 'Song 1 - Slowed', author: 'Artist', encodedTrack: 'e2', duration: 100, uri: 'u2', source: 'spotify', requesterId: 'u' },
          { id: '3', title: 'Song 1 - Sped Up', author: 'Artist', encodedTrack: 'e3', duration: 100, uri: 'u3', source: 'spotify', requesterId: 'u' },
        ],
      }),
    };

    const service = new MusicService(mockMusicManager, mockTrackResolver, silentLogger);

    const result = await service.play({
      guildId: 'test_guild',
      voiceChannelId: 'test_vc',
      textChannelId: 'test_tc',
      query: 'Song 1',
      requesterId: 'user_1',
    });

    // Only 1 track should be enqueued, not 3!
    expect(result.tracks.length).toBe(1);
    expect(result.tracks[0].title).toBe('Song 1');
    expect(player.queue.size).toBe(0); // It immediately played the 1 track, leaving 0 upcoming in queue
    expect(player.queue.current?.title).toBe('Song 1');
  });
});
