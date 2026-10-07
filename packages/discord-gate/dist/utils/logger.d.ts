/**
 * Simple logger utility for DiscordGate services
 * Can be replaced with a proper logging library (pino, winston) later
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export declare function setLogLevel(level: LogLevel): void;
export declare const logger: {
    debug: (message: string, meta?: Record<string, unknown>) => void;
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
    setLevel: typeof setLogLevel;
};
export {};
//# sourceMappingURL=logger.d.ts.map