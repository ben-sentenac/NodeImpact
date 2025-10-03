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
        const fn = (userLogger && typeof userLogger[method] === 'function') ? userLogger[method].bind(userLogger) : null;
        return (...args) => {
            //level < seront ignorés
            if ((LEVEL_INDEX[method] ?? 99) < threshold) return;
            if(!fn) return;
            if (fn) {
                try {
                   return fn(...args);
                } catch (error) {
                    console.error(error)
                    //silent no-op
                    
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

/*
const { logger, calls } = (() => {
  const calls = { debug: [], info: [], warn: [], error: [] };
  const logger = {
    debug: (...a) => calls.debug.push(a),
    info:  (...a) => calls.info.push(a),
    warn:  (...a) => calls.warn.push(a),
    error: (...a) => calls.error.push(a),
  };
  return { logger, calls };
})();

const log = createLogger(logger, 'debug');
console.log(log.debug('file.read.ok', { pid: 123 }));
console.log(calls)
// Attendu: calls.debug.length === 1 et calls.debug[0][0] === 'file.read.ok'
*/