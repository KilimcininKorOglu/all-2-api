/**
 * Unified Logging Module
 * Supports writing to different log files by module
 */
import fs from 'fs';
import path from 'path';

// Log directory
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Get current timestamp string
 */
function getTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Get current date string (for log file names)
 */
function getDateStr() {
    return new Date().toISOString().substring(0, 10);
}

/**
 * Log levels
 */
const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

/**
 * Dynamic settings (can be updated from DB)
 */
let dynamicSettings = {
    level: LogLevel.INFO,
    enabled: true,
    consoleOutput: true
};

// Initialize from environment variables (fallback)
if (process.env.LOG_LEVEL) {
    const level = process.env.LOG_LEVEL.toUpperCase();
    if (LogLevel[level] !== undefined) {
        dynamicSettings.level = LogLevel[level];
    }
}
dynamicSettings.enabled = process.env.LOG_ENABLED !== 'false';
dynamicSettings.consoleOutput = process.env.LOG_CONSOLE !== 'false';

/**
 * Update logger settings dynamically (called from DB settings)
 */
export function updateLoggerSettings(settings) {
    if (settings.logLevel) {
        const level = settings.logLevel.toUpperCase();
        if (LogLevel[level] !== undefined) {
            dynamicSettings.level = LogLevel[level];
        }
    }
    if (settings.logEnabled !== undefined) {
        dynamicSettings.enabled = settings.logEnabled;
    }
    if (settings.logConsole !== undefined) {
        dynamicSettings.consoleOutput = settings.logConsole;
    }
}

/**
 * Get current settings
 */
export function getLoggerSettings() {
    return { ...dynamicSettings };
}

/**
 * Write stream cache
 */
const streams = new Map();

/**
 * Get or create write stream
 * @param {string} module - Module name
 * @returns {fs.WriteStream}
 */
function getStream(module) {
    const dateStr = getDateStr();
    const key = `${module}-${dateStr}`;

    if (streams.has(key)) {
        return streams.get(key);
    }

    // Close old streams (from different dates)
    for (const [k, stream] of streams) {
        if (k.startsWith(`${module}-`) && k !== key) {
            stream.end();
            streams.delete(k);
        }
    }

    const filePath = path.join(LOG_DIR, `${module}-${dateStr}.log`);
    const stream = fs.createWriteStream(filePath, { flags: 'a' });
    streams.set(key, stream);

    return stream;
}

/**
 * Write log to file
 * @param {string} module - Module name
 * @param {string} level - Log level
 * @param {string} message - Log message
 */
function writeToFile(module, level, message) {
    const stream = getStream(module);
    const line = `[${getTimestamp()}] [${level}] ${message}\n`;
    stream.write(line);
}

/**
 * Format arguments to string
 */
function formatArgs(args) {
    return args.map(arg => {
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg);
            } catch {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ');
}

/**
 * Create module logger
 * @param {string} module - Module name
 * @returns {Object} Logger object
 */
export function createLogger(module) {
    const prefix = `[${module}]`;

    return {
        debug(...args) {
            if (dynamicSettings.enabled && dynamicSettings.level <= LogLevel.DEBUG) {
                const message = formatArgs(args);
                writeToFile(module, 'DEBUG', message);
            }
        },

        info(...args) {
            if (dynamicSettings.enabled && dynamicSettings.level <= LogLevel.INFO) {
                const message = formatArgs(args);
                writeToFile(module, 'INFO', message);
            }
        },

        warn(...args) {
            if (dynamicSettings.enabled && dynamicSettings.level <= LogLevel.WARN) {
                const message = formatArgs(args);
                writeToFile(module, 'WARN', message);
            }
        },

        error(...args) {
            if (dynamicSettings.enabled && dynamicSettings.level <= LogLevel.ERROR) {
                const message = formatArgs(args);
                writeToFile(module, 'ERROR', message);
                if (dynamicSettings.consoleOutput) {
                    console.error(`[${getTimestamp()}] ${prefix} [ERROR]`, ...args);
                }
            }
        },

        /**
         * Log HTTP request
         */
        request(method, url) {
            this.info(`Request: ${method} ${url}`);
        },

        /**
         * Log success
         */
        success(message) {
            this.info(`✓ ${message}`);
        },

        /**
         * Log failure
         */
        fail(message, statusCode) {
            if (statusCode) {
                this.error(`✗ ${message} (HTTP ${statusCode})`);
            } else {
                this.error(`✗ ${message}`);
            }
        },

        /**
         * Print curl command
         */
        curl(method, url, headers, data) {
            const curlCmd = buildCurlCommand(method, url, headers, data);
            this.info(`CURL:\n${curlCmd}`);
        }
    };
}

/**
 * Build curl command string
 * @param {string} method - HTTP method
 * @param {string} url - Request URL
 * @param {Object} headers - Request headers
 * @param {Object|string} data - Request body
 * @returns {string} curl command
 */
function buildCurlCommand(method, url, headers, data) {
    const parts = ['curl'];

    // Add method
    if (method && method.toUpperCase() !== 'GET') {
        parts.push(`-X ${method.toUpperCase()}`);
    }

    // Add URL
    parts.push(`'${url}'`);

    // Add request headers (no masking, full output)
    if (headers) {
        for (const [key, value] of Object.entries(headers)) {
            parts.push(`-H '${key}: ${value}'`);
        }
    }

    // Add request body (full output, no truncation)
    if (data) {
        let bodyStr;
        if (typeof data === 'string') {
            bodyStr = data;
        } else {
            bodyStr = JSON.stringify(data);
        }
        // Escape single quotes
        bodyStr = bodyStr.replace(/'/g, "'\\''");
        parts.push(`-d '${bodyStr}'`);
    }

    return parts.join(' \\\n  ');
}

/**
 * Predefined module loggers
 * Each module writes to independent log files:
 * - logs/api-YYYY-MM-DD.log
 * - logs/client-YYYY-MM-DD.log
 * - logs/auth-YYYY-MM-DD.log
 * - logs/db-YYYY-MM-DD.log
 * - logs/server-YYYY-MM-DD.log
 * - logs/token-YYYY-MM-DD.log
 */
export const logger = {
    api: createLogger('api'),
    client: createLogger('client'),
    auth: createLogger('auth'),
    db: createLogger('db'),
    server: createLogger('server'),
    token: createLogger('token')
};

/**
 * Set log level
 * @param {string} level - Log level (DEBUG/INFO/WARN/ERROR)
 */
export function setLogLevel(level) {
    const upperLevel = level.toUpperCase();
    if (LogLevel[upperLevel] !== undefined) {
        dynamicSettings.level = LogLevel[upperLevel];
    }
}

/**
 * Close all log streams
 */
export function closeAllStreams() {
    for (const [, stream] of streams) {
        stream.end();
    }
    streams.clear();
}

/**
 * Get timestamp (for external use)
 */
export { getTimestamp };

export default logger;
