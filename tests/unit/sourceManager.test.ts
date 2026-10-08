import { describe, it, expect } from 'vitest';
import { SourceManager } from '@/sources/SourceManager';

describe('SourceManager (Intelligent Source Detection)', () => {
  const manager = new SourceManager();

  it('should detect YouTube URLs', () => {
    expect(manager.findSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ').name).toBe('youtube');
    expect(manager.findSource('https://youtu.be/dQw4w9WgXcQ').name).toBe('youtube');
    expect(manager.findSource('https://music.youtube.com/watch?v=dQw4w9WgXcQ').name).toBe('youtube');
    expect(manager.findSource('ytsearch:Never Gonna Give You Up').name).toBe('youtube');
  });

  it('should detect Spotify URLs and URIs', () => {
    expect(manager.findSource('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT').name).toBe('spotify');
    expect(manager.findSource('https://open.spotify.com/intl-de/album/1DFixLWuPkv3KT3TnV35m3').name).toBe('spotify');
    expect(manager.findSource('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M').name).toBe('spotify');
    expect(manager.findSource('spotify:track:4cOdK2wGLETKBW3PvgPWqT').name).toBe('spotify');
    expect(manager.findSource('spsearch:Cruel Summer').name).toBe('spotify');
  });

  it('should detect SoundCloud URLs', () => {
    expect(manager.findSource('https://soundcloud.com/artist/song-title').name).toBe('soundcloud');
    expect(manager.findSource('scsearch:electronic chill').name).toBe('soundcloud');
  });

  it('should detect Local audio files', () => {
    expect(manager.findSource('local:track.mp3').name).toBe('local');
    expect(manager.findSource('my_music/song.flac').name).toBe('local');
    expect(manager.findSource('file:///music/song.wav').name).toBe('local');
  });

  it('should detect Direct HTTP audio URLs', () => {
    expect(manager.findSource('https://example.com/audio/podcast.mp3').name).toBe('http');
    expect(manager.findSource('http://stream.radio.org/live.ogg').name).toBe('http');
  });

  it('should route plain text queries to configured default search source', () => {
    expect(manager.findSource('Bohemian Rhapsody').name).toBe('spotify');
    const customManager = new SourceManager({ DEFAULT_SEARCH_SOURCE: 'youtube' } as any);
    expect(customManager.findSource('Bohemian Rhapsody').name).toBe('youtube');
    const scManager = new SourceManager({ DEFAULT_SEARCH_SOURCE: 'soundcloud' } as any);
    expect(scManager.findSource('Bohemian Rhapsody').name).toBe('soundcloud');
  });
});
