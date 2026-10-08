import { EventEmitter } from 'events';
import { AsyncLocalStorage } from 'async_hooks';
import { PlaybackState } from './types/playback';
import { Logger } from 'pino';

export class PlaybackController extends EventEmitter {
  private _state: PlaybackState = 'IDLE';
  private _isLocked = false;
  private readonly _lockWaiters: Array<() => void> = [];
  private readonly _asyncLocalStorage = new AsyncLocalStorage<boolean>();
  private readonly _logger: Logger;

  constructor(logger: Logger) {
    super();
    this._logger = logger.child({ module: 'PlaybackController' });
  }

  get state(): PlaybackState {
    return this._state;
  }

  public canTransitionTo(next: PlaybackState): boolean {
    switch (this._state) {
      case 'IDLE':
        return next === 'BUFFERING' || next === 'PLAYING' || next === 'ERROR' || next === 'ENDED' || next === 'IDLE';
      case 'BUFFERING':
        return next === 'PLAYING' || next === 'ERROR' || next === 'IDLE' || next === 'ENDED';
      case 'PLAYING':
        return next === 'PAUSED' || next === 'ENDED' || next === 'BUFFERING' || next === 'ERROR' || next === 'IDLE';
      case 'PAUSED':
        return next === 'PLAYING' || next === 'BUFFERING' || next === 'ENDED' || next === 'ERROR' || next === 'IDLE';
      case 'ENDED':
        return next === 'PLAYING' || next === 'BUFFERING' || next === 'ERROR' || next === 'ENDED' || next === 'IDLE';
      case 'ERROR':
        return next === 'PLAYING' || next === 'BUFFERING' || next === 'ERROR' || next === 'ENDED' || next === 'IDLE';
      default:
        return true;
    }
  }

  public transition(next: PlaybackState, reason?: string): boolean {
    if (this._state === next) {
      return true;
    }

    if (!this.canTransitionTo(next)) {
      this._logger.warn(
        `Invalid state transition requested: ${this._state} -> ${next} (Reason: ${reason || 'unspecified'})`
      );
      return false;
    }

    const previous = this._state;
    this._state = next;
    this._logger.debug(`State changed: ${previous} -> ${next} (Reason: ${reason || 'none'})`);
    this.emit('stateChange', previous, next);
    return true;
  }

  /**
   * Acquire an async lock for executing critical playback operations
   * preventing concurrency issues on rapid skips, plays, or seeks.
   * Re-entrant across nested calls in the same asynchronous call stack.
   */
  public async withLock<T>(action: () => Promise<T>): Promise<T> {
    if (this._asyncLocalStorage.getStore()) {
      return await action();
    }

    while (this._isLocked) {
      await new Promise<void>((resolve) => this._lockWaiters.push(resolve));
    }

    this._isLocked = true;
    try {
      return await this._asyncLocalStorage.run(true, async () => {
        return await action();
      });
    } finally {
      this._isLocked = false;
      const nextWaiter = this._lockWaiters.shift();
      if (nextWaiter) {
        nextWaiter();
      }
    }
  }
}
