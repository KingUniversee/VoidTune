import { describe, it, expect, vi } from 'vitest';
import { PlaybackController } from '@/music/PlaybackController';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

describe('PlaybackController (State Machine & Mutex)', () => {
  it('should initialize in IDLE state', () => {
    const controller = new PlaybackController(silentLogger);
    expect(controller.state).toBe('IDLE');
  });

  it('should transition through valid playback lifecycle', () => {
    const controller = new PlaybackController(silentLogger);
    const stateSpy = vi.fn();
    controller.on('stateChange', stateSpy);

    // IDLE -> BUFFERING
    expect(controller.transition('BUFFERING')).toBe(true);
    expect(controller.state).toBe('BUFFERING');

    // BUFFERING -> PLAYING
    expect(controller.transition('PLAYING')).toBe(true);
    expect(controller.state).toBe('PLAYING');

    // PLAYING -> PAUSED
    expect(controller.transition('PAUSED')).toBe(true);
    expect(controller.state).toBe('PAUSED');

    // PAUSED -> PLAYING
    expect(controller.transition('PLAYING')).toBe(true);
    expect(controller.state).toBe('PLAYING');

    // PLAYING -> ENDED
    expect(controller.transition('ENDED')).toBe(true);
    expect(controller.state).toBe('ENDED');

    // ENDED -> IDLE
    expect(controller.transition('IDLE')).toBe(true);
    expect(controller.state).toBe('IDLE');

    expect(stateSpy).toHaveBeenCalledTimes(6);
  });

  it('should reject invalid state transitions', () => {
    const controller = new PlaybackController(silentLogger);

    // Cannot transition directly from IDLE to PAUSED
    expect(controller.transition('PAUSED')).toBe(false);
    expect(controller.state).toBe('IDLE');
  });

  it('should serialize concurrent operations via withLock', async () => {
    const controller = new PlaybackController(silentLogger);
    const executionOrder: number[] = [];

    const task1 = controller.withLock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      executionOrder.push(1);
    });

    const task2 = controller.withLock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      executionOrder.push(2);
    });

    const task3 = controller.withLock(async () => {
      executionOrder.push(3);
    });

    await Promise.all([task1, task2, task3]);

    // Despite timing differences, tasks must execute strictly in lock arrival order
    expect(executionOrder).toEqual([1, 2, 3]);
  });
});
