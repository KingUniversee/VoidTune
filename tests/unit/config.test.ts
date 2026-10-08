import { describe, it, expect } from 'vitest';
import { parseEnv } from '@/config/env';

describe('Config (Zod Environment Validation)', () => {
  it('should parse valid environment variables correctly', () => {
    const custom = {
      NODE_ENV: 'production',
      DISCORD_TOKEN: 'valid_sample_token',
      DISCORD_CLIENT_ID: '987654321098765432',
      DEFAULT_PREFIX: '?',
      LOG_LEVEL: 'warn',
    };

    const parsed = parseEnv(custom);

    expect(parsed.NODE_ENV).toBe('production');
    expect(parsed.DISCORD_TOKEN).toBe('valid_sample_token');
    expect(parsed.DISCORD_CLIENT_ID).toBe('987654321098765432');
    expect(parsed.DEFAULT_PREFIX).toBe('?');
    expect(parsed.LOG_LEVEL).toBe('warn');
  });

  it('should apply sensible defaults when optional fields are omitted', () => {
    const custom = {
      NODE_ENV: 'test',
    };

    const parsed = parseEnv(custom);

    expect(parsed.DEFAULT_PREFIX).toBe('!');
    expect(parsed.LOG_LEVEL).toBe('info');
    expect(parsed.LAVALINK_PORT).toBe(2333);
    expect(parsed.LAVALINK_SECURE).toBe(false);
  });

  it('should throw validation error when required variables are missing in non-test mode', () => {
    const custom = {
      NODE_ENV: 'production',
      // DISCORD_TOKEN and DISCORD_CLIENT_ID missing
    };

    expect(() => parseEnv(custom)).toThrowError(/Environment validation failed/);
  });
});
