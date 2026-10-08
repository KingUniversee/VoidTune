import { describe, it, expect } from 'vitest';
import { SpotifySource } from '@/sources/SpotifySource';
import { SourceContext } from '@/sources/AudioSource';
import pino from 'pino';

import { config } from '@/config/env';

const silentLogger = pino({ level: 'silent' });

describe('SpotifySource (URL Pattern & Auth Handling)', () => {
  const spotifySource = new SpotifySource();

  it('should accurately recognize Spotify URLs and URIs', () => {
    expect(spotifySource.supports('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')).toBe(true);
    expect(spotifySource.supports('https://open.spotify.com/intl-es/track/4cOdK2wGLETKBW3PvgPWqT')).toBe(true);
    expect(spotifySource.supports('https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3')).toBe(true);
    expect(spotifySource.supports('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toBe(true);
    expect(spotifySource.supports('spotify:track:4cOdK2wGLETKBW3PvgPWqT')).toBe(true);
    expect(spotifySource.supports('https://youtube.com/watch?v=123')).toBe(false);
  });

  it('should reject resolution with SOURCE_AUTH_FAILED if client credentials are not configured', async () => {
    const origId = config.SPOTIFY_CLIENT_ID;
    const origSecret = config.SPOTIFY_CLIENT_SECRET;
    (config as any).SPOTIFY_CLIENT_ID = undefined;
    (config as any).SPOTIFY_CLIENT_SECRET = undefined;

    const mockContext: SourceContext = {
      requesterId: 'user_1',
      shoukaku: {} as any,
      logger: silentLogger,
    };

    try {
      await expect(
        spotifySource.resolve('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', mockContext)
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'SOURCE_AUTH_FAILED',
        })
      );
    } finally {
      (config as any).SPOTIFY_CLIENT_ID = origId;
      (config as any).SPOTIFY_CLIENT_SECRET = origSecret;
    }
  });
});
