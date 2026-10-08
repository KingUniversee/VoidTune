import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file if present
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Discord Credentials
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  
  // Core Settings
  DEFAULT_PREFIX: z.string().min(1).default('!'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  
  // Database (PostgreSQL) - optional in Phase 1
  DATABASE_URL: z.string().optional(),
  
  // Redis - optional in Phase 1
  REDIS_URL: z.string().optional(),
  
  // Lavalink v4 - optional in Phase 1
  LAVALINK_URI: z.string().optional(),
  LAVALINK_HOST: z.string().default('localhost'),
  LAVALINK_PORT: z.coerce.number().default(2333),
  LAVALINK_PASSWORD: z.string().default('youshallnotpass'),
  LAVALINK_SECURE: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
  
  // Spotify Credentials - optional in Phase 1
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  
  // Audio Source Settings - Phase 3
  MUSIC_LIBRARY_PATH: z.string().default('./music'),
  DEFAULT_SEARCH_SOURCE: z.enum(['spotify', 'youtube', 'soundcloud']).default('youtube'),
  SOURCE_PRIORITY: z.string().default('youtube,spotify,soundcloud'),
  
  // Fastify API - optional in Phase 1
  API_PORT: z.coerce.number().default(3000),
  API_HOST: z.string().default('0.0.0.0'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function parseEnv(customEnv?: Record<string, unknown>): EnvConfig {
  const source = { ...(customEnv || process.env) } as Record<string, any>;
  
  // Parse LAVALINK_URI if specified
  if (source.LAVALINK_URI) {
    try {
      const parsedUrl = new URL(String(source.LAVALINK_URI));
      source.LAVALINK_HOST = parsedUrl.hostname;
      source.LAVALINK_PORT = parsedUrl.port ? Number(parsedUrl.port) : (parsedUrl.protocol === 'https:' ? 443 : 80);
      source.LAVALINK_SECURE = parsedUrl.protocol === 'https:';
    } catch {
      // Keep default host/port if URI is invalid
    }
  }

  // Provide test fallbacks if in test environment and not explicitly set
  const isTest = (source.NODE_ENV ?? process.env.NODE_ENV) === 'test';
  const effectiveSource = {
    ...source,
    DISCORD_TOKEN: source.DISCORD_TOKEN || (isTest ? 'mock_test_token' : undefined),
    DISCORD_CLIENT_ID:
      source.DISCORD_CLIENT_ID ||
      source.DISCORD_APPLICATION_ID ||
      (isTest ? '123456789012345678' : undefined),
  };

  const result = envSchema.safeParse(effectiveSource);

  if (!result.success) {
    const errorDetails = result.error.errors
      .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    console.error('❌ Environment validation failed:\n' + errorDetails);
    throw new Error(`Environment validation failed:\n${errorDetails}`);
  }

  return result.data;
}

export const config: EnvConfig = parseEnv();
