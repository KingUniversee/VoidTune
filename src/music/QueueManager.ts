import { Track, RepeatMode } from './types/track';

export interface PaginatedQueue {
  items: Track[];
  page: number;
  totalPages: number;
  pageSize: number;
  totalTracks: number;
  totalDurationMs: number;
}

export class QueueManager {
  private _tracks: Track[] = [];
  private _history: Track[] = [];
  private _current: Track | null = null;
  private _repeatMode: RepeatMode = 'off';

  get current(): Track | null {
    return this._current;
  }

  get tracks(): ReadonlyArray<Track> {
    return this._tracks;
  }

  get history(): ReadonlyArray<Track> {
    return this._history;
  }

  get repeatMode(): RepeatMode {
    return this._repeatMode;
  }

  get size(): number {
    return this._tracks.length;
  }

  get isEmpty(): boolean {
    return this._tracks.length === 0;
  }

  get totalDuration(): number {
    const queueSum = this._tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
    return queueSum + (this._current?.duration || 0);
  }

  public setCurrent(track: Track | null): void {
    this._current = track;
  }

  public setRepeatMode(mode: RepeatMode): void {
    this._repeatMode = mode;
  }

  public add(item: Track | Track[]): void {
    if (Array.isArray(item)) {
      this._tracks.push(...item);
    } else {
      this._tracks.push(item);
    }
  }

  public addNext(item: Track | Track[]): void {
    if (Array.isArray(item)) {
      this._tracks.unshift(...item);
    } else {
      this._tracks.unshift(item);
    }
  }

  public remove(index: number): Track | null {
    if (index < 0 || index >= this._tracks.length) {
      return null;
    }
    const removed = this._tracks.splice(index, 1);
    return removed[0] ?? null;
  }

  public clear(): void {
    this._tracks = [];
  }

  public clearAll(): void {
    this._tracks = [];
    this._history = [];
    this._current = null;
  }

  public move(fromIndex: number, toIndex: number): boolean {
    if (
      fromIndex < 0 ||
      fromIndex >= this._tracks.length ||
      toIndex < 0 ||
      toIndex >= this._tracks.length
    ) {
      return false;
    }

    const item = this._tracks.splice(fromIndex, 1)[0];
    if (!item) return false;

    this._tracks.splice(toIndex, 0, item);
    return true;
  }

  public jump(index: number): Track | null {
    if (index < 0 || index >= this._tracks.length) {
      return null;
    }

    // Move skipped tracks up to index into history
    if (this._current) {
      this._history.push(this._current);
    }
    const skipped = this._tracks.splice(0, index);
    this._history.push(...skipped);

    const nextTrack = this._tracks.shift() || null;
    this._current = nextTrack;
    return nextTrack;
  }

  public shuffle(): void {
    // Standard Fisher-Yates shuffle algorithm
    for (let i = this._tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const current = this._tracks[i];
      const target = this._tracks[j];
      if (current && target) {
        this._tracks[i] = target;
        this._tracks[j] = current;
      }
    }
  }

  public next(): Track | null {
    if (this._repeatMode === 'track' && this._current) {
      return this._current;
    }

    if (this._current) {
      if (this._repeatMode === 'queue') {
        this._tracks.push(this._current);
      } else {
        this._history.push(this._current);
        // Retain max 50 items in history to avoid unbounded memory growth
        if (this._history.length > 50) {
          this._history.shift();
        }
      }
    }

    this._current = this._tracks.shift() || null;
    return this._current;
  }

  public previous(): Track | null {
    if (this._history.length === 0) {
      return null;
    }

    const prev = this._history.pop() || null;
    if (!prev) return null;

    if (this._current) {
      this._tracks.unshift(this._current);
    }

    this._current = prev;
    return this._current;
  }

  public getPaginated(page = 1, pageSize = 10): PaginatedQueue {
    const totalTracks = this._tracks.length;
    const totalPages = Math.max(1, Math.ceil(totalTracks / pageSize));
    const validPage = Math.max(1, Math.min(page, totalPages));

    const startIndex = (validPage - 1) * pageSize;
    const items = this._tracks.slice(startIndex, startIndex + pageSize);

    return {
      items,
      page: validPage,
      totalPages,
      pageSize,
      totalTracks,
      totalDurationMs: this.totalDuration,
    };
  }

  public exportState(): { current: Track | null; tracks: Track[]; repeatMode: RepeatMode } {
    return {
      current: this._current,
      tracks: [...this._tracks],
      repeatMode: this._repeatMode,
    };
  }

  public importState(data: { current: Track | null; tracks: Track[]; repeatMode: RepeatMode }): void {
    this._current = data.current;
    this._tracks = [...data.tracks];
    this._repeatMode = data.repeatMode;
  }
}
