import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GuildPlayer } from '@/music/GuildPlayer';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

describe('GuildPlayer - 24/7 Mode and Inactivity Countdown', () => {
  let mockShoukakuPlayer: any;
  let player: GuildPlayer;

  beforeEach(() => {
    vi.useFakeTimers();
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
    vi.useRealTimers();
  });

  it('should initialize with 24/7 mode disabled', () => {
    expect(player.is247).toBe(false);
  });

  it('should toggle 24/7 mode and emit 247Change event', () => {
    const listener = vi.fn();
    player.on('247Change', listener);

    player.set247(true);
    expect(player.is247).toBe(true);
    expect(listener).toHaveBeenCalledWith(true);

    player.set247(false);
    expect(player.is247).toBe(false);
    expect(listener).toHaveBeenCalledWith(false);
  });

  it('should trigger inactivityTimeout event after 5 minutes when 24/7 is off', () => {
    const timeoutSpy = vi.fn();
    player.on('inactivityTimeout', timeoutSpy);

    player.startInactivityTimer('queue ended');
    expect(timeoutSpy).not.toHaveBeenCalled();

    // Fast-forward 4 minutes
    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(timeoutSpy).not.toHaveBeenCalled();

    // Fast-forward 1 more minute (total 5 minutes)
    vi.advanceTimersByTime(1 * 60 * 1000);
    expect(timeoutSpy).toHaveBeenCalledWith('queue ended');
  });

  it('should not start inactivity timer when 24/7 is enabled', () => {
    const timeoutSpy = vi.fn();
    player.on('inactivityTimeout', timeoutSpy);

    player.set247(true);
    player.startInactivityTimer('test');

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(timeoutSpy).not.toHaveBeenCalled();
  });

  it('should clear running inactivity timer if 24/7 is enabled afterwards', () => {
    const timeoutSpy = vi.fn();
    player.on('inactivityTimeout', timeoutSpy);

    player.startInactivityTimer('idle');
    vi.advanceTimersByTime(3 * 60 * 1000);

    // Enabling 24/7 should clear the active timer
    player.set247(true);

    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(timeoutSpy).not.toHaveBeenCalled();
  });

  it('should clear timer when clearInactivityTimer is called', () => {
    const timeoutSpy = vi.fn();
    player.on('inactivityTimeout', timeoutSpy);

    player.startInactivityTimer('idle');
    vi.advanceTimersByTime(2 * 60 * 1000);

    player.clearInactivityTimer();
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(timeoutSpy).not.toHaveBeenCalled();
  });
});
