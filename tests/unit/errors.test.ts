import { describe, it, expect } from 'vitest';
import {
  VoidTuneError,
  EchoTuneError,
  VoiceError,
  MusicError,
  SourceError,
  PermissionError,
  RateLimitError,
} from '@/utils/errors';

describe('Error Taxonomy & Normalization', () => {
  it('should instantiate VoidTuneError with code, message, and details', () => {
    const err = new VoidTuneError({
      code: 'UNKNOWN_ERROR',
      message: 'Internal processing failure',
      userMessage: 'Something went wrong',
      details: { traceId: '12345' },
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(VoidTuneError);
    expect(err).toBeInstanceOf(EchoTuneError);
    expect(err.code).toBe('UNKNOWN_ERROR');
    expect(err.message).toBe('Internal processing failure');
    expect(err.userMessage).toBe('Something went wrong');
    expect(err.details).toEqual({ traceId: '12345' });
  });

  it('should format VoiceError properly with default user message', () => {
    const err = new VoiceError('USER_NOT_IN_VOICE', 'Channel missing');
    expect(err.code).toBe('USER_NOT_IN_VOICE');
    expect(err.userMessage).toContain('Voice connection error');
  });

  it('should format PermissionError with PERMISSION_DENIED code', () => {
    const err = new PermissionError('Missing ManageGuild permission');
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.userMessage).toContain('permission');
  });

  it('should format RateLimitError with retry time in message and details', () => {
    const err = new RateLimitError(5, { command: 'play' });
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.userMessage).toContain('wait 5s');
    expect(err.details).toEqual({ retryAfterSeconds: 5, command: 'play' });
  });

  it('should format MusicError and SourceError with default messages', () => {
    const musicErr = new MusicError('PLAYER_ERROR', 'Buffer underflow');
    expect(musicErr.code).toBe('PLAYER_ERROR');
    expect(musicErr.userMessage).toContain('audio playback');

    const sourceErr = new SourceError('SOURCE_UNAVAILABLE', 'Connection reset');
    expect(sourceErr.code).toBe('SOURCE_UNAVAILABLE');
    expect(sourceErr.userMessage).toContain('audio from that source');
  });
});
