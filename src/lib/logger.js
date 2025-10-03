const LOG_LEVELS = [
    'debug',
    'info',
    'warn',
    'error'
];

const LEVEL_INDEX = Object.fromEntries(LOG_LEVELS.map((level, index) => [level, index]));

export function createLogger(userLogger, level = 'warn') {
    const threshold = LEVEL_INDEX[level] ?? LEVEL_INDEX.warn;
    const safe = (method) => {
        const fn = userLogger && typeof userLogger[method] === 'function' ? userLogger[method].bind(userLogger) : null;
        return (...args) => {
            //level < seront ignorés
            if ((LEVEL_INDEX[method] ?? 99) < threshold) return;
            if (fn) {
                try {
                    return fn(...args);
                } catch (error) {
                    //silent
                }
            }
        }
    }

    return {
        debug: safe('debug'),
        info: safe('info'),
        warn: safe('warn'),
        error: safe('error'),
    }
}
