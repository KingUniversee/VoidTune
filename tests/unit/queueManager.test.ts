import { describe, it, expect, beforeEach } from 'vitest';
import { QueueManager } from '@/music/QueueManager';
import { Track } from '@/music/types/track';

function createMockTrack(id: string, title: string, durationMs = 180000): Track {
  return {
    id,
    encodedTrack: `encoded_${id}`,
    title,
    author: 'Test Artist',
    duration: durationMs,
    uri: `https://example.com/${id}`,
    source: 'youtube',
    requesterId: 'user_123',
  };
}

describe('QueueManager', () => {
  let queue: QueueManager;

  beforeEach(() => {
    queue = new QueueManager();
  });

  it('should initialize empty', () => {
    expect(queue.size).toBe(0);
    expect(queue.isEmpty).toBe(true);
    expect(queue.current).toBeNull();
    expect(queue.totalDuration).toBe(0);
  });

  it('should add single and multiple tracks', () => {
    const track1 = createMockTrack('1', 'Song 1');
    const track2 = createMockTrack('2', 'Song 2');
    const track3 = createMockTrack('3', 'Song 3');

    queue.add(track1);
    expect(queue.size).toBe(1);

    queue.add([track2, track3]);
    expect(queue.size).toBe(3);
    expect(queue.tracks[0]?.title).toBe('Song 1');
    expect(queue.tracks[2]?.title).toBe('Song 3');
  });

  it('should add tracks to front with addNext', () => {
    const track1 = createMockTrack('1', 'Song 1');
    const track2 = createMockTrack('2', 'Song 2');
    const urgentTrack = createMockTrack('priority', 'Urgent Song');

    queue.add([track1, track2]);
    queue.addNext(urgentTrack);

    expect(queue.tracks[0]?.id).toBe('priority');
    expect(queue.size).toBe(3);
  });

  it('should remove track by index', () => {
    const t1 = createMockTrack('1', 'Song 1');
    const t2 = createMockTrack('2', 'Song 2');
    const t3 = createMockTrack('3', 'Song 3');

    queue.add([t1, t2, t3]);
    const removed = queue.remove(1); // remove index 1 ('Song 2')

    expect(removed?.title).toBe('Song 2');
    expect(queue.size).toBe(2);
    expect(queue.tracks[1]?.title).toBe('Song 3');
  });

  it('should move tracks within queue', () => {
    const t1 = createMockTrack('1', 'Song 1');
    const t2 = createMockTrack('2', 'Song 2');
    const t3 = createMockTrack('3', 'Song 3');

    queue.add([t1, t2, t3]);
    const success = queue.move(0, 2); // move Song 1 to index 2

    expect(success).toBe(true);
    expect(queue.tracks[0]?.title).toBe('Song 2');
    expect(queue.tracks[1]?.title).toBe('Song 3');
    expect(queue.tracks[2]?.title).toBe('Song 1');
  });

  it('should jump to target track and push skipped tracks into history', () => {
    const t1 = createMockTrack('1', 'Song 1');
    const t2 = createMockTrack('2', 'Song 2');
    const t3 = createMockTrack('3', 'Song 3');
    const t4 = createMockTrack('4', 'Song 4');

    queue.setCurrent(t1);
    queue.add([t2, t3, t4]);

    const jumped = queue.jump(1); // jump to Song 3 (index 1 of upcoming)

    expect(jumped?.title).toBe('Song 3');
    expect(queue.current?.title).toBe('Song 3');
    expect(queue.history.map((t) => t.title)).toEqual(['Song 1', 'Song 2']);
    expect(queue.tracks.map((t) => t.title)).toEqual(['Song 4']);
  });

  it('should handle repeatMode: track', () => {
    const t1 = createMockTrack('1', 'Song 1');
    const t2 = createMockTrack('2', 'Song 2');

    queue.setCurrent(t1);
    queue.add(t2);
    queue.setRepeatMode('track');

    const nextTrack = queue.next();
    expect(nextTrack?.id).toBe('1');
    expect(queue.size).toBe(1); // Queue did not shift
  });

  it('should handle repeatMode: queue', () => {
    const t1 = createMockTrack('1', 'Song 1');
    const t2 = createMockTrack('2', 'Song 2');

    queue.setCurrent(t1);
    queue.add(t2);
    queue.setRepeatMode('queue');

    const nextTrack = queue.next();
    expect(nextTrack?.id).toBe('2');
    expect(queue.tracks[0]?.id).toBe('1'); // Song 1 re-added to back
  });

  it('should handle previous track navigation', () => {
    const t1 = createMockTrack('1', 'Song 1');
    const t2 = createMockTrack('2', 'Song 2');
    const t3 = createMockTrack('3', 'Song 3');

    queue.setCurrent(t1);
    queue.add([t2, t3]);

    queue.next(); // current is now t2, history is [t1]
    expect(queue.current?.id).toBe('2');

    const prev = queue.previous();
    expect(prev?.id).toBe('1');
    expect(queue.current?.id).toBe('1');
    expect(queue.tracks[0]?.id).toBe('2'); // t2 pushed back to front of upcoming
  });

  it('should paginate queue items correctly', () => {
    const tracks = Array.from({ length: 25 }, (_, i) =>
      createMockTrack(String(i), `Track ${i}`)
    );
    queue.add(tracks);

    const page1 = queue.getPaginated(1, 10);
    expect(page1.items.length).toBe(10);
    expect(page1.totalPages).toBe(3);
    expect(page1.totalTracks).toBe(25);
    expect(page1.items[0]?.title).toBe('Track 0');

    const page3 = queue.getPaginated(3, 10);
    expect(page3.items.length).toBe(5);
    expect(page3.page).toBe(3);
    expect(page3.items[4]?.title).toBe('Track 24');
  });

  it('should shuffle queue without losing any tracks', () => {
    const tracks = Array.from({ length: 50 }, (_, i) =>
      createMockTrack(String(i), `Track ${i}`)
    );
    queue.add(tracks);

    queue.shuffle();

    expect(queue.size).toBe(50);
    const ids = new Set(queue.tracks.map((t) => t.id));
    expect(ids.size).toBe(50);
  });
});
