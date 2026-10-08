import pino from 'pino';
import { config } from '../config/env';

const isProduction = config.NODE_ENV === 'production';

export const logger = pino({
  level: config.LOG_LEVEL,
  transport: !isProduction
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    env: config.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export interface LogContext {
  guildId?: string;
  userId?: string;
  command?: string;
  module?: string;
  trackId?: string;
  source?: string;
  lavalinkNode?: string;
  [key: string]: unknown;
}

export function createChildLogger(moduleName: string, defaultContext?: LogContext) {
  return logger.child({
    module: moduleName,
    ...defaultContext,
  });
}
