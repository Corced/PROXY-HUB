// Simple logger utility for Discord bot
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
  timestamp: string;
}

const logLevels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLogLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return logLevels[level] >= logLevels[currentLogLevel];
}

function formatEntry(level: LogLevel, message: string, meta?: Record<string, unknown>): LogEntry {
  return {
    level,
    message,
    meta,
    timestamp: new Date().toISOString(),
  };
}

function writeLog(entry: LogEntry): void {
  const { level, message, meta, timestamp } = entry;
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';

  switch (level) {
    case 'debug':
      console.debug(`${prefix} ${message}${metaStr}`);
      break;
    case 'info':
      console.info(`${prefix} ${message}${metaStr}`);
      break;
    case 'warn':
      console.warn(`${prefix} ${message}${metaStr}`);
      break;
    case 'error':
      console.error(`${prefix} ${message}${metaStr}`);
      break;
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>): void => {
    if (shouldLog('debug')) writeLog(formatEntry('debug', message, meta));
  },
  info: (message: string, meta?: Record<string, unknown>): void => {
    if (shouldLog('info')) writeLog(formatEntry('info', message, meta));
  },
  warn: (message: string, meta?: Record<string, unknown>): void => {
    if (shouldLog('warn')) writeLog(formatEntry('warn', message, meta));
  },
  error: (message: string, meta?: Record<string, unknown>): void => {
    if (shouldLog('error')) writeLog(formatEntry('error', message, meta));
  },
  setLevel: setLogLevel,
};