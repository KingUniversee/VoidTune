import { describe, it, expect, vi } from 'vitest';
import { TrackResolver } from '@/music/TrackResolver';
import { SourceManager } from '@/sources/SourceManager';
import { AudioSource, ResolvedResult } from '@/sources/AudioSource';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

describe('TrackResolver (Resolution Pipeline & Caching)', () => {
  it('should reject empty queries', async () => {
    const manager = new SourceManager();
    const resolver = new TrackResolver(manager, {} as any, silentLogger);

    await expect(resolver.resolve('', 'user_1')).rejects.toThrowError(
      expect.objectContaining({
        code: 'INVALID_QUERY',
      })
    );
  });

  it('should cache resolved tracks and return cached result with updated requesterId', async () => {
    const manager = new SourceManager();

    const mockSource: AudioSource = {
      name: 'custom',
      priority: 1,
      supports: (input) => input.startsWith('custom:'),
      resolve: vi.fn().mockResolvedValue({
        type: 'track',
        tracks: [
          {
            id: 'mock_1',
            encodedTrack: 'enc',
            title: 'Test Song',
            author: 'Artist',
            duration: 120000,
            uri: 'https://example.com/1',
            source: 'youtube',
            requesterId: 'original_user',
          },
        ],
      } as ResolvedResult),
    };

    manager.registerSource(mockSource);
    const resolver = new TrackResolver(manager, {} as any, silentLogger);

    // First call: resolves from source
    const result1 = await resolver.resolve('custom:track', 'user_first');
    expect(result1.tracks[0]?.title).toBe('Test Song');
    expect(result1.tracks[0]?.requesterId).toBe('user_first');
    expect(mockSource.resolve).toHaveBeenCalledTimes(1);

    // Second call with same query: resolved from in-memory cache
    const result2 = await resolver.resolve('custom:track', 'user_second');
    expect(result2.tracks[0]?.title).toBe('Test Song');
    expect(result2.tracks[0]?.requesterId).toBe('user_second'); // requester updated!
    expect(mockSource.resolve).toHaveBeenCalledTimes(1); // not called again!
  });
});
