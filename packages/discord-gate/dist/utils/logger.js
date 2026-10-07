/**
 * Simple logger utility for DiscordGate services
 * Can be replaced with a proper logging library (pino, winston) later
 */
const logLevels = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
let currentLogLevel = 'info';
export function setLogLevel(level) {
    currentLogLevel = level;
}
function shouldLog(level) {
    return logLevels[level] >= logLevels[currentLogLevel];
}
function formatEntry(level, message, meta) {
    return {
        level,
        message,
        meta,
        timestamp: new Date().toISOString(),
    };
}
function writeLog(entry) {
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
    debug: (message, meta) => {
        if (shouldLog('debug'))
            writeLog(formatEntry('debug', message, meta));
    },
    info: (message, meta) => {
        if (shouldLog('info'))
            writeLog(formatEntry('info', message, meta));
    },
    warn: (message, meta) => {
        if (shouldLog('warn'))
            writeLog(formatEntry('warn', message, meta));
    },
    error: (message, meta) => {
        if (shouldLog('error'))
            writeLog(formatEntry('error', message, meta));
    },
    setLevel: setLogLevel,
};
//# sourceMappingURL=logger.js.map