const fs = require("fs");
const path = require("path");

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function truncateString(value, max = 2000) {
  if (typeof value !== "string") return value;
  if (value.length <= max) return value;
  return `${value.slice(0, max)} ... [truncated ${value.length - max} chars]`;
}

function sanitizeValue(value, depth = 0) {
  if (depth > 6) return "[depth-limited]";

  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncateString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => sanitizeValue(v, depth + 1));
  }

  if (typeof value === "object") {
    const out = {};
    const entries = Object.entries(value).slice(0, 100);
    for (const [key, raw] of entries) {
      if (/api[_-]?key|token|secret|password/i.test(key)) {
        out[key] = "[REDACTED]";
        continue;
      }
      out[key] = sanitizeValue(raw, depth + 1);
    }
    return out;
  }

  return String(value);
}

function noopLogger() {
  const noop = () => {};
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => noopLogger(),
    getLogFilePath: () => null,
  };
}

function getTodayLogName(prefix) {
  const date = new Date().toISOString().slice(0, 10);
  return `${prefix}-${date}.log`;
}

async function maybeRotate(logFilePath, maxBytes) {
  try {
    const stat = await fs.promises.stat(logFilePath);
    if (stat.size < maxBytes) return;

    const rotated = `${logFilePath}.${Date.now()}.bak`;
    await fs.promises.rename(logFilePath, rotated);
  } catch {
    // Ignore missing file and rotation failures to avoid crashing chat path.
  }
}

function createLogger(options = {}) {
  const logDir = options.logDir;
  if (!logDir) return noopLogger();

  const levelName = String(options.level || "info").toLowerCase();
  const minLevel = LEVELS[levelName] || LEVELS.info;
  const maxBytes = Number(options.maxBytes) || 5_000_000;
  const prefix = options.prefix || "gemini-web";

  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    return noopLogger();
  }

  function getLogFilePath() {
    return path.join(logDir, getTodayLogName(prefix));
  }

  // Fire-and-forget async write -- never blocks the event loop
  function write(level, event, data) {
    const levelValue = LEVELS[level] || LEVELS.info;
    if (levelValue < minLevel) return;

    const logFilePath = getLogFilePath();
    const entry = {
      ts: new Date().toISOString(),
      level,
      event,
      data: sanitizeValue(data),
    };

    maybeRotate(logFilePath, maxBytes)
      .then(() =>
        fs.promises.appendFile(
          logFilePath,
          `${JSON.stringify(entry)}\n`,
          "utf8",
        ),
      )
      .catch(() => {
        // Do not throw from logger path.
      });
  }

  function child(defaultFields = {}) {
    return {
      debug: (event, data = {}) =>
        write("debug", event, { ...defaultFields, ...data }),
      info: (event, data = {}) =>
        write("info", event, { ...defaultFields, ...data }),
      warn: (event, data = {}) =>
        write("warn", event, { ...defaultFields, ...data }),
      error: (event, data = {}) =>
        write("error", event, { ...defaultFields, ...data }),
      child: (extra = {}) => child({ ...defaultFields, ...extra }),
      getLogFilePath,
    };
  }

  return child();
}

module.exports = {
  createLogger,
  noopLogger,
};
