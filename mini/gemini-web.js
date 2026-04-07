const http = require("http");
const path = require("path");
const crypto = require("crypto");

const { getGeminiRuntimeConfig } = require("./gemini-env");
const { createGeminiAgent } = require("./gemini-agent");
const { createLogger } = require("./gemini-logger");
const {
  saveSession,
  loadAllSessions,
  deleteSession,
} = require("./gemini-sessions");

const ALLOWED_MODELS = [
  "gemini-3-pro-preview",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
];

const MAX_BODY_BYTES = 1_048_576; // 1 MB

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy(new Error("Request body too large"));
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const parsed = raw ? JSON.parse(raw) : {};
        resolve(parsed);
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const fs = require("fs");

const PUBLIC_DIR = path.join(__dirname, "public");

// Cache static files at startup for performance
let cachedIndexHtml = null;
let cachedStyleCss = null;
let cachedAppJs = null;

function loadStaticFiles() {
  cachedIndexHtml = fs.readFileSync(
    path.join(PUBLIC_DIR, "index.html"),
    "utf8",
  );
  cachedStyleCss = fs.readFileSync(path.join(PUBLIC_DIR, "style.css"), "utf8");
  cachedAppJs = fs.readFileSync(path.join(PUBLIC_DIR, "app.js"), "utf8");
}

function buildHtml(model, allowedModels, token) {
  if (!cachedIndexHtml) loadStaticFiles();

  return cachedIndexHtml
    .replace("{{MODEL}}", model)
    .replace("{{ALLOWED_MODELS}}", JSON.stringify(allowedModels))
    .replace("{{MODEL_JSON}}", JSON.stringify(model))
    .replace("{{TOKEN}}", JSON.stringify(token));
}

const STATIC_CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // per window per IP
const THINKING_MODES = ["adaptive", "enabled", "disabled"];
const SETTINGS_BOUNDS = {
  temperature: { min: 0, max: 2 },
  topP: { min: 0, max: 1 },
  topK: { min: 1, max: 200 },
  maxOutputTokens: { min: 256, max: 65536 },
  thinkingBudget: { min: 0, max: 32768 },
  maxTurns: { min: 1, max: 200 },
  maxToolCalls: { min: 1, max: 200 },
  commandTimeoutMs: { min: 1000, max: 60000 },
};

// Simple in-memory token bucket rate limiter
const rateBuckets = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    bucket = { windowStart: now, count: 0 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX_REQUESTS;
}

function setCorsHeaders(res, port) {
  res.setHeader("Access-Control-Allow-Origin", `http://localhost:${port}`);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function coerceNumber(value, fieldName) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${fieldName} must be a finite number`);
    }
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${fieldName} must be a finite number`);
    }
    return parsed;
  }
  throw new Error(`${fieldName} must be a number`);
}

function coerceBoolean(value, fieldName) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  throw new Error(`${fieldName} must be a boolean`);
}

function buildDefaultSettings(runtime, allowedModels) {
  const fallbackModel = "gemini-3-flash-preview";
  const selectedModel = allowedModels.includes(runtime.model)
    ? runtime.model
    : fallbackModel;
  return {
    model: selectedModel,
    temperature: runtime.temperature,
    topP: runtime.topP,
    topK: runtime.topK,
    maxOutputTokens: runtime.maxOutputTokens,
    thinkingMode: runtime.thinkingMode,
    thinkingBudget: runtime.thinkingBudget,
    systemPrompt: runtime.systemPrompt,
    maxTurns: runtime.maxTurns,
    maxToolCalls: runtime.maxToolCalls,
    commandTimeoutMs: runtime.commandTimeoutMs,
    allowOutsideRoot: runtime.allowOutsideRoot,
  };
}

function normalizeSettingsUpdate(currentSettings, patch, allowedModels) {
  const next = { ...currentSettings };
  if (!patch || typeof patch !== "object") {
    return next;
  }

  if (patch.model !== undefined) {
    if (typeof patch.model !== "string") {
      throw new Error("model must be a string");
    }
    const model = patch.model.trim();
    if (!allowedModels.includes(model)) {
      throw new Error("model must be one of the allowed Gemini options");
    }
    next.model = model;
  }

  if (patch.temperature !== undefined) {
    next.temperature = clamp(
      coerceNumber(patch.temperature, "temperature"),
      SETTINGS_BOUNDS.temperature.min,
      SETTINGS_BOUNDS.temperature.max,
    );
  }

  if (patch.topP !== undefined) {
    next.topP = clamp(
      coerceNumber(patch.topP, "topP"),
      SETTINGS_BOUNDS.topP.min,
      SETTINGS_BOUNDS.topP.max,
    );
  }

  if (patch.topK !== undefined) {
    next.topK = Math.round(
      clamp(
        coerceNumber(patch.topK, "topK"),
        SETTINGS_BOUNDS.topK.min,
        SETTINGS_BOUNDS.topK.max,
      ),
    );
  }

  if (patch.maxOutputTokens !== undefined) {
    next.maxOutputTokens = Math.round(
      clamp(
        coerceNumber(patch.maxOutputTokens, "maxOutputTokens"),
        SETTINGS_BOUNDS.maxOutputTokens.min,
        SETTINGS_BOUNDS.maxOutputTokens.max,
      ),
    );
  }

  if (patch.thinkingMode !== undefined) {
    if (typeof patch.thinkingMode !== "string") {
      throw new Error("thinkingMode must be a string");
    }
    const normalizedMode = patch.thinkingMode.trim().toLowerCase();
    if (!THINKING_MODES.includes(normalizedMode)) {
      throw new Error("thinkingMode must be adaptive, enabled, or disabled");
    }
    next.thinkingMode = normalizedMode;
  }

  if (patch.thinkingBudget !== undefined) {
    next.thinkingBudget = Math.round(
      clamp(
        coerceNumber(patch.thinkingBudget, "thinkingBudget"),
        SETTINGS_BOUNDS.thinkingBudget.min,
        SETTINGS_BOUNDS.thinkingBudget.max,
      ),
    );
  }

  if (patch.systemPrompt !== undefined) {
    if (typeof patch.systemPrompt !== "string") {
      throw new Error("systemPrompt must be a string");
    }
    next.systemPrompt = patch.systemPrompt.slice(0, 12000);
  }

  if (patch.maxTurns !== undefined) {
    next.maxTurns = Math.round(
      clamp(
        coerceNumber(patch.maxTurns, "maxTurns"),
        SETTINGS_BOUNDS.maxTurns.min,
        SETTINGS_BOUNDS.maxTurns.max,
      ),
    );
  }

  if (patch.maxToolCalls !== undefined) {
    next.maxToolCalls = Math.round(
      clamp(
        coerceNumber(patch.maxToolCalls, "maxToolCalls"),
        SETTINGS_BOUNDS.maxToolCalls.min,
        SETTINGS_BOUNDS.maxToolCalls.max,
      ),
    );
  }

  if (patch.commandTimeoutMs !== undefined) {
    next.commandTimeoutMs = Math.round(
      clamp(
        coerceNumber(patch.commandTimeoutMs, "commandTimeoutMs"),
        SETTINGS_BOUNDS.commandTimeoutMs.min,
        SETTINGS_BOUNDS.commandTimeoutMs.max,
      ),
    );
  }

  if (patch.allowOutsideRoot !== undefined) {
    next.allowOutsideRoot = coerceBoolean(
      patch.allowOutsideRoot,
      "allowOutsideRoot",
    );
  }

  return next;
}

async function startGeminiWebServer(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, "..");
  const runtime = getGeminiRuntimeConfig({
    rootDir,
    modelOverride: options.modelOverride,
    portOverride: options.port,
  });

  const logger = createLogger({
    logDir: runtime.logDir,
    level: runtime.logLevel,
    maxBytes: runtime.logMaxBytes,
  });
  const serverLogger = logger.child({ component: "web" });

  // Generate auth token for this server instance
  const authToken = crypto.randomBytes(32).toString("hex");

  const defaultSettings = buildDefaultSettings(runtime, ALLOWED_MODELS);
  let currentSettings = { ...defaultSettings };

  if (currentSettings.model !== runtime.model) {
    serverLogger.warn("unsupported_startup_model", {
      requestedModel: runtime.model,
      fallbackModel: currentSettings.model,
      allowedModels: ALLOWED_MODELS,
    });
  }

  const agent = createGeminiAgent({
    rootDir,
    apiKey: runtime.apiKey,
    ...currentSettings,
    logger: logger.child({ component: "agent" }),
  });

  serverLogger.info("server_boot", {
    rootDir,
    model: currentSettings.model,
    port: runtime.port,
    maxTurns: currentSettings.maxTurns,
    maxToolCalls: currentSettings.maxToolCalls,
    commandTimeoutMs: currentSettings.commandTimeoutMs,
    allowedModels: ALLOWED_MODELS,
    allowOutsideRoot: currentSettings.allowOutsideRoot,
    logFile: logger.getLogFilePath(),
  });

  const sessionsDir = path.join(rootDir, "sessions");
  const sessions = await loadAllSessions(sessionsDir, serverLogger);
  if (sessions.size > 0) {
    serverLogger.info("sessions_restored", { count: sessions.size });
  }

  function evictStaleSessions() {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastAccessedAt > SESSION_TTL_MS) {
        sessions.delete(id);
        deleteSession(sessionsDir, id).catch(() => {});
        serverLogger.info("session_evicted", { sessionId: id });
      }
    }
  }

  const cleanupTimer = setInterval(
    evictStaleSessions,
    SESSION_CLEANUP_INTERVAL_MS,
  );
  cleanupTimer.unref();

  function getOrCreateSession(requestedId) {
    if (requestedId && sessions.has(requestedId)) {
      const existing = sessions.get(requestedId);
      existing.lastAccessedAt = Date.now();
      if (!existing.currentDir) {
        existing.currentDir = rootDir;
      }
      return existing;
    }

    // Evict oldest session if at capacity
    if (sessions.size >= MAX_SESSIONS) {
      let oldestId = null;
      let oldestTime = Infinity;
      for (const [id, s] of sessions) {
        if (s.lastAccessedAt < oldestTime) {
          oldestTime = s.lastAccessedAt;
          oldestId = id;
        }
      }
      if (oldestId) {
        sessions.delete(oldestId);
        deleteSession(sessionsDir, oldestId).catch(() => {});
        serverLogger.info("session_evicted_capacity", { sessionId: oldestId });
      }
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    const session = {
      id,
      contents: [],
      totalToolCalls: 0,
      currentDir: rootDir,
      createdAt: now,
      lastAccessedAt: now,
    };
    sessions.set(id, session);
    return session;
  }

  function checkAuth(req) {
    const authHeader = req.headers["authorization"] || "";
    return authHeader === `Bearer ${authToken}`;
  }

  const server = http.createServer(async (req, res) => {
    const requestId = crypto.randomUUID();
    const reqLogger = serverLogger.child({ requestId });

    reqLogger.info("http_request_start", {
      method: req.method,
      url: req.url,
      remoteAddress: req.socket?.remoteAddress || null,
    });

    try {
      const url = req.url || "/";

      // CORS headers on all responses
      setCorsHeaders(res, runtime.port);

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Rate limiting on API routes
      if (url.startsWith("/api/")) {
        const clientIp = req.socket?.remoteAddress || "unknown";
        if (!checkRateLimit(clientIp)) {
          res.setHeader("Retry-After", "60");
          sendJson(res, 429, { error: "Too many requests" });
          reqLogger.warn("http_request_end", { status: 429 });
          return;
        }

        // Auth check for API routes
        if (!checkAuth(req)) {
          sendJson(res, 401, { error: "Unauthorized" });
          reqLogger.warn("http_request_end", { status: 401 });
          return;
        }
      }

      if (req.method === "GET" && url === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(buildHtml(currentSettings.model, ALLOWED_MODELS, authToken));
        reqLogger.info("http_request_end", { status: 200 });
        return;
      }

      // Serve static assets from mini/public/
      if (req.method === "GET" && (url === "/style.css" || url === "/app.js")) {
        if (!cachedStyleCss) loadStaticFiles();
        const ext = path.extname(url);
        const contentType =
          STATIC_CONTENT_TYPES[ext] || "application/octet-stream";
        const content = url === "/style.css" ? cachedStyleCss : cachedAppJs;
        res.writeHead(200, { "content-type": contentType });
        res.end(content);
        reqLogger.info("http_request_end", { status: 200, route: "static" });
        return;
      }

      if (req.method === "GET" && url === "/api/health") {
        sendJson(res, 200, {
          ok: true,
          model: currentSettings.model,
          maxTurns: currentSettings.maxTurns,
          maxToolCalls: currentSettings.maxToolCalls,
          commandTimeoutMs: currentSettings.commandTimeoutMs,
          settings: currentSettings,
          allowedModels: ALLOWED_MODELS,
        });
        reqLogger.info("http_request_end", { status: 200, route: "health" });
        return;
      }

      if (req.method === "GET" && url === "/api/models") {
        sendJson(res, 200, {
          model: currentSettings.model,
          models: ALLOWED_MODELS,
        });
        reqLogger.info("http_request_end", { status: 200, route: "models" });
        return;
      }

      if (req.method === "GET" && url === "/api/settings") {
        sendJson(res, 200, {
          settings: currentSettings,
          defaults: defaultSettings,
          allowedModels: ALLOWED_MODELS,
          thinkingModes: THINKING_MODES,
        });
        reqLogger.info("http_request_end", { status: 200, route: "settings" });
        return;
      }

      if (req.method === "POST" && url === "/api/settings") {
        const body = await readJsonBody(req);
        try {
          if (body && body.resetToDefaults === true) {
            currentSettings = { ...defaultSettings };
          } else {
            const patch =
              body && body.settings && typeof body.settings === "object"
                ? body.settings
                : body;
            currentSettings = normalizeSettingsUpdate(
              currentSettings,
              patch,
              ALLOWED_MODELS,
            );
          }
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : String(error),
          });
          reqLogger.warn("http_request_end", {
            status: 400,
            route: "settings",
            error: error instanceof Error ? error.message : String(error),
          });
          return;
        }

        sendJson(res, 200, {
          ok: true,
          settings: currentSettings,
          defaults: defaultSettings,
          allowedModels: ALLOWED_MODELS,
          thinkingModes: THINKING_MODES,
        });
        reqLogger.info("http_request_end", { status: 200, route: "settings" });
        return;
      }

      if (req.method === "GET" && url === "/api/sessions") {
        const list = [];
        for (const [, s] of sessions) {
          const messageCount = s.contents.filter(
            (c) => c.role === "user",
          ).length;
          list.push({
            id: s.id,
            createdAt: s.createdAt,
            lastAccessedAt: s.lastAccessedAt,
            messageCount,
          });
        }
        list.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
        sendJson(res, 200, { sessions: list });
        reqLogger.info("http_request_end", { status: 200, route: "sessions" });
        return;
      }

      if (
        req.method === "GET" &&
        url.startsWith("/api/sessions/") &&
        url.endsWith("/export")
      ) {
        const exportId = url.slice("/api/sessions/".length, -"/export".length);
        const exportSession = sessions.get(exportId);
        if (!exportSession) {
          sendJson(res, 404, { error: "Session not found" });
          reqLogger.warn("http_request_end", {
            status: 404,
            route: "session_export",
          });
          return;
        }
        const messages = exportSession.contents.map((c) => ({
          role: c.role,
          text: c.parts
            .map(
              (p) =>
                p.text ||
                (p.functionCall ? `[tool: ${p.functionCall.name}]` : "") ||
                (p.functionResponse
                  ? `[result: ${p.functionResponse.name}]`
                  : ""),
            )
            .join("\n"),
        }));
        sendJson(res, 200, {
          id: exportSession.id,
          createdAt: exportSession.createdAt,
          messages,
          exportedAt: new Date().toISOString(),
        });
        reqLogger.info("http_request_end", {
          status: 200,
          route: "session_export",
        });
        return;
      }

      if (req.method === "POST" && url === "/api/model") {
        const body = await readJsonBody(req);
        const requestedModel =
          typeof body.model === "string" ? body.model.trim() : "";

        if (!ALLOWED_MODELS.includes(requestedModel)) {
          sendJson(res, 400, {
            error: "model must be one of the allowed Gemini options",
            allowedModels: ALLOWED_MODELS,
          });
          reqLogger.warn("model_switch_failed", {
            status: 400,
            requestedModel,
          });
          reqLogger.warn("http_request_end", { status: 400, route: "model" });
          return;
        }

        if (requestedModel !== currentSettings.model) {
          currentSettings = {
            ...currentSettings,
            model: requestedModel,
          };
          reqLogger.info("model_switched", {
            model: currentSettings.model,
          });
        }

        sendJson(res, 200, {
          ok: true,
          model: currentSettings.model,
          models: ALLOWED_MODELS,
          settings: currentSettings,
        });
        reqLogger.info("http_request_end", { status: 200, route: "model" });
        return;
      }

      if (req.method === "POST" && url === "/api/chat") {
        const body = await readJsonBody(req);
        const message =
          typeof body.message === "string" ? body.message.trim() : "";
        if (!message) {
          sendJson(res, 400, { error: "message is required" });
          reqLogger.warn("chat_validation_failed", {
            status: 400,
            reason: "message is required",
          });
          reqLogger.warn("http_request_end", { status: 400, route: "chat" });
          return;
        }

        const session = getOrCreateSession(body.sessionId);
        reqLogger.info("chat_request", {
          status: 200,
          sessionId: session.id,
          messageLength: message.length,
        });
        const result = await agent.sendMessage(
          session,
          message,
          undefined,
          currentSettings,
        );
        saveSession(sessionsDir, session).catch(() => {});

        sendJson(res, 200, {
          sessionId: session.id,
          currentDir: session.currentDir,
          model: currentSettings.model,
          reply: result.reply,
          events: result.events,
          finishReason: result.finishReason,
        });
        reqLogger.info("http_request_end", {
          status: 200,
          route: "chat",
          sessionId: session.id,
          finishReason: result.finishReason,
        });
        return;
      }

      if (req.method === "POST" && url === "/api/chat/stream") {
        const body = await readJsonBody(req);
        const message =
          typeof body.message === "string" ? body.message.trim() : "";
        if (!message) {
          sendJson(res, 400, { error: "message is required" });
          reqLogger.warn("http_request_end", {
            status: 400,
            route: "chat/stream",
          });
          return;
        }

        const session = getOrCreateSession(body.sessionId);
        reqLogger.info("chat_stream_request", {
          sessionId: session.id,
          messageLength: message.length,
        });

        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });

        // Send session ID immediately so the client can track it
        res.write(
          `data: ${JSON.stringify({ type: "session", sessionId: session.id })}\n\n`,
        );

        let closed = false;
        req.on("close", () => {
          closed = true;
        });

        try {
          await agent.sendMessage(
            session,
            message,
            (event) => {
              if (closed) return;
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            },
            currentSettings,
          );
          saveSession(sessionsDir, session).catch(() => {});
        } catch (streamError) {
          if (!closed) {
            const errMsg =
              streamError instanceof Error
                ? streamError.message
                : String(streamError);
            res.write(
              `data: ${JSON.stringify({ type: "error", message: errMsg })}\n\n`,
            );
          }
        }

        if (!closed) {
          res.write("data: [DONE]\n\n");
          res.end();
        }
        reqLogger.info("http_request_end", {
          status: 200,
          route: "chat/stream",
          sessionId: session.id,
        });
        return;
      }

      sendJson(res, 404, { error: "Not found" });
      reqLogger.warn("http_request_end", { status: 404 });
    } catch (error) {
      reqLogger.error("http_request_error", {
        error: error instanceof Error ? error.message : String(error),
      });
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  server.listen(runtime.port, "127.0.0.1", () => {
    console.log(`Local Code Agent running at http://localhost:${runtime.port}`);
    console.log(`Auth token: ${authToken}`);
    console.log(`Model: ${currentSettings.model}`);
    console.log(`Max turns: ${currentSettings.maxTurns}`);
    console.log(`Max tool calls: ${currentSettings.maxToolCalls}`);
    console.log(`Command timeout ms: ${currentSettings.commandTimeoutMs}`);
    console.log(`Logs: ${logger.getLogFilePath() || "disabled"}`);
    if (currentSettings.allowOutsideRoot) {
      console.log("Outside-root file access: enabled");
    }
    console.log("Tip: Use Ctrl/Cmd+Enter to send quickly from the textarea.");
  });

  // Graceful shutdown
  function shutdown(signal) {
    serverLogger.info("shutdown_start", { signal });
    console.log(`\nReceived ${signal}, shutting down...`);
    clearInterval(cleanupTimer);
    server.close(() => {
      serverLogger.info("shutdown_complete");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  }
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

module.exports = {
  startGeminiWebServer,
};
