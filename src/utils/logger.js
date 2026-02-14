const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function resolveLevel(input) {
  const key = String(input || 'info').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, key) ? key : 'info';
}

function createLogger(scope, level = 'info') {
  const resolved = resolveLevel(level);
  const threshold = LEVELS[resolved];

  const log = (name, message, meta) => {
    if (LEVELS[name] > threshold) return;
    const prefix = `[${scope}][${name}]`;
    if (meta === undefined) {
      console[name === 'debug' ? 'log' : name](`${prefix} ${message}`);
      return;
    }
    console[name === 'debug' ? 'log' : name](`${prefix} ${message}`, meta);
  };

  return {
    level: resolved,
    error: (m, meta) => log('error', m, meta),
    warn: (m, meta) => log('warn', m, meta),
    info: (m, meta) => log('info', m, meta),
    debug: (m, meta) => log('debug', m, meta),
  };
}

module.exports = {
  createLogger,
};
