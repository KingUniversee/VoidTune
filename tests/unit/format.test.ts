import { describe, it, expect } from 'vitest';
import { formatDuration, createProgressBar } from '@/utils/format';

describe('Format Utilities', () => {
  describe('formatDuration', () => {
    it('should format 0 ms as 0:00', () => {
      expect(formatDuration(0)).toBe('0:00');
      expect(formatDuration(-100)).toBe('0:00');
    });

    it('should format seconds and minutes correctly', () => {
      expect(formatDuration(45000)).toBe('0:45');
      expect(formatDuration(75000)).toBe('1:15');
      expect(formatDuration(615000)).toBe('10:15');
    });

    it('should format hours correctly', () => {
      expect(formatDuration(3665000)).toBe('1:01:05');
      expect(formatDuration(7325000)).toBe('2:02:05');
    });
  });

  describe('createProgressBar', () => {
    it('should create empty progress bar at 0 ms', () => {
      const bar = createProgressBar(0, 100000, 10);
      expect(bar).toBe('🔘' + '▬'.repeat(10));
    });

    it('should place dot in middle around 50%', () => {
      const bar = createProgressBar(50000, 100000, 10);
      expect(bar).toContain('🔘');
      expect(bar.length).toBeGreaterThan(5);
    });

    it('should place dot at end at 100%', () => {
      const bar = createProgressBar(100000, 100000, 10);
      expect(bar.endsWith('🔘')).toBe(true);
    });
  });
});
