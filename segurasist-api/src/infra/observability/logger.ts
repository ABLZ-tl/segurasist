import type { Logger, LoggerOptions } from 'pino';
import pino from 'pino';

export function buildLogger(level: string = process.env.LOG_LEVEL ?? 'info'): Logger {
  const opts: LoggerOptions = {
    level,
    base: { service: 'segurasist-api' },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['password', 'token', 'authorization', 'cookie', '*.password', '*.token'],
      censor: '[REDACTED]',
    },
  };
  return pino(opts);
}
