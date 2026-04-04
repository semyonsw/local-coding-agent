const fs = require("fs");
const path = require("path");

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return defaultValue;
}

function parsePositiveInt(value, name, { min = 1, max } = {}) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < min) {
    throw new Error(`Invalid ${name}: ${String(value)}`);
  }

  if (typeof max === "number" && numeric > max) {
    throw new Error(`Invalid ${name}: ${String(value)} (must be <= ${max})`);
  }

  return numeric;
}

function parseDotEnv(content) {
  const result = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (!key) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function loadDotEnvIfPresent(rootDir) {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return { loaded: false, envPath };

  const file = fs.readFileSync(envPath, "utf8");
  const parsed = parseDotEnv(file);

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return { loaded: true, envPath };
}

function getGeminiRuntimeConfig(options = {}) {
  const rootDir = options.rootDir;
  if (!rootDir) {
    throw new Error("getGeminiRuntimeConfig requires rootDir");
  }

  loadDotEnvIfPresent(rootDir);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing GEMINI_API_KEY. Add it to .env as GEMINI_API_KEY=your_key",
    );
  }

  const model =
    options.modelOverride ||
    process.env.GEMINI_MODEL ||
    "gemini-3-flash-preview";

  const portRaw = options.portOverride || process.env.GEMINI_WEB_PORT || "7789";
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid port: ${String(portRaw)}`);
  }

  const logDirRaw = process.env.GEMINI_LOG_DIR || "logs";
  const logDir = path.isAbsolute(logDirRaw)
    ? logDirRaw
    : path.resolve(rootDir, logDirRaw);

  const logLevel = String(process.env.GEMINI_LOG_LEVEL || "info").toLowerCase();
  const logMaxBytesRaw = process.env.GEMINI_LOG_MAX_BYTES || "5000000";
  const logMaxBytes = Number(logMaxBytesRaw);
  if (!Number.isFinite(logMaxBytes) || logMaxBytes <= 0) {
    throw new Error(`Invalid GEMINI_LOG_MAX_BYTES: ${String(logMaxBytesRaw)}`);
  }

  const allowOutsideRoot = parseBoolean(
    process.env.GEMINI_ALLOW_OUTSIDE_ROOT,
    false,
  );

  const maxTurns = parsePositiveInt(
    process.env.GEMINI_MAX_TURNS || "10",
    "GEMINI_MAX_TURNS",
    { max: 200 },
  );

  const maxToolCalls = parsePositiveInt(
    process.env.GEMINI_MAX_TOOL_CALLS || "20",
    "GEMINI_MAX_TOOL_CALLS",
    { max: 200 },
  );

  const commandTimeoutMs = parsePositiveInt(
    process.env.GEMINI_COMMAND_TIMEOUT_MS || "15000",
    "GEMINI_COMMAND_TIMEOUT_MS",
    { max: 60000 },
  );

  const maxOutputTokens = parsePositiveInt(
    process.env.GEMINI_MAX_OUTPUT_TOKENS || "8192",
    "GEMINI_MAX_OUTPUT_TOKENS",
    { max: 65536 },
  );

  return {
    apiKey,
    model,
    port,
    maxTurns,
    maxToolCalls,
    commandTimeoutMs,
    maxOutputTokens,
    logDir,
    logLevel,
    logMaxBytes,
    allowOutsideRoot,
  };
}

module.exports = {
  getGeminiRuntimeConfig,
  loadDotEnvIfPresent,
};
