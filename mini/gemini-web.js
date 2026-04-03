const http = require("http");
const path = require("path");
const crypto = require("crypto");

const { getGeminiRuntimeConfig } = require("./gemini-env");
const { createGeminiAgent } = require("./gemini-agent");
const { createLogger } = require("./gemini-logger");

const ALLOWED_MODELS = [
  "gemini-3-pro-preview",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
];

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
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

function buildHtml(model, allowedModels) {
  const allowedModelsJson = JSON.stringify(allowedModels);
  const initialModelJson = JSON.stringify(model);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Local Code Agent</title>
    <style>
      :root {
        --bg: #000000;
        --panel: #050505;
        --panel-soft: #0b0b0b;
        --line: #252525;
        --line-strong: #3a3a3a;
        --text: #f4f4f4;
        --muted: #a8a8a8;
        --action: #f2f2f2;
        --action-text: #060606;
      }
      * { box-sizing: border-box; }
      html,
      body {
        height: 100%;
      }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", "Noto Sans", sans-serif;
        color: var(--text);
        background: var(--bg);
        overflow-x: hidden;
      }
      .app {
        min-height: 100vh;
        width: 100%;
        background:
          radial-gradient(1200px 300px at 8% -10%, #121212 0%, transparent 52%),
          radial-gradient(1000px 300px at 96% -18%, #0d0d0d 0%, transparent 50%),
          var(--bg);
        display: grid;
        grid-template-rows: auto 1fr auto auto;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px clamp(12px, 3vw, 32px);
        border-bottom: 1px solid var(--line);
        background: rgba(0, 0, 0, 0.82);
        backdrop-filter: blur(5px);
      }
      .title {
        font-size: 28px;
        font-weight: 700;
        letter-spacing: 0.4px;
      }
      .meta {
        color: var(--muted);
        font-size: 14px;
      }

      .controls {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .control-label {
        color: var(--muted);
        font-size: 13px;
        letter-spacing: 0.2px;
      }

      select {
        background: #090909;
        color: var(--text);
        border: 1px solid var(--line-strong);
        border-radius: 10px;
        padding: 8px 10px;
        min-width: 220px;
      }

      .chat {
        overflow-y: auto;
        overflow-x: hidden;
        padding: 18px clamp(12px, 3vw, 32px);
      }

      .msg {
        margin-bottom: 14px;
        padding: 14px;
        border-radius: 12px;
        border: 1px solid var(--line);
        background: var(--panel-soft);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
        max-width: 100%;
      }

      .msg-label {
        font-weight: 700;
        margin-bottom: 6px;
      }

      .msg.user {
        background: #101010;
        border-color: #3f3f3f;
      }

      .msg.assistant {
        background: #060606;
        border-color: #222222;
      }

      .events {
        margin-top: 10px;
        border: 1px dashed var(--line-strong);
        border-radius: 8px;
        background: #020202;
      }

      .events summary {
        cursor: pointer;
        color: var(--muted);
        padding: 9px 10px;
        user-select: none;
      }

      .events pre {
        margin: 0;
        padding: 0 10px 10px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        color: #d6d6d6;
      }

      .composer {
        border-top: 1px solid var(--line);
        padding: 12px clamp(12px, 3vw, 32px);
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        background: rgba(0, 0, 0, 0.88);
      }

      textarea {
        width: 100%;
        resize: vertical;
        min-height: 74px;
        max-height: 220px;
        padding: 10px;
        border: 1px solid var(--line-strong);
        background: #080808;
        color: var(--text);
        border-radius: 10px;
        font: inherit;
      }

      textarea::placeholder {
        color: #888888;
      }

      textarea:focus-visible {
        outline: 2px solid #dddddd;
        outline-offset: 1px;
      }

      button {
        border: 1px solid var(--line-strong);
        border-radius: 10px;
        padding: 0 14px;
        font-weight: 600;
        cursor: pointer;
        color: var(--action-text);
        background: var(--action);
        min-height: 44px;
      }

      #newBtn {
        background: #101010;
        color: var(--text);
      }

      button:hover {
        filter: brightness(1.05);
      }

      button:focus-visible {
        outline: 2px solid #e7e7e7;
        outline-offset: 1px;
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .status {
        padding: 8px clamp(12px, 3vw, 32px) 14px;
        font-size: 13px;
        color: var(--muted);
        border-top: 1px solid var(--line);
      }

      @media (max-width: 700px) {
        .header {
          align-items: flex-start;
          flex-direction: column;
        }

        .controls {
          width: 100%;
          display: grid;
          grid-template-columns: 1fr;
          gap: 8px;
        }

        select {
          min-width: 0;
          width: 100%;
        }

        .composer {
          grid-template-columns: 1fr;
        }

        button {
          height: 42px;
        }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <div class="header">
        <div>
          <div class="title">Local Code Agent</div>
          <div id="modelMeta" class="meta">Model: ${model}</div>
        </div>
        <div class="controls">
          <label class="control-label" for="modelSelect">Model</label>
          <select id="modelSelect"></select>
          <button id="newBtn" type="button" onclick="window.__newSession && window.__newSession()">New Session</button>
        </div>
      </div>

      <div id="chat" class="chat"></div>
      <div class="composer">
        <textarea id="prompt" placeholder="Ask about code, request file edits, or run repo commands..."></textarea>
        <button id="sendBtn" type="button" onclick="window.__sendPrompt && window.__sendPrompt()">Send</button>
      </div>
      <div id="status" class="status">Ready.</div>
    </div>

    <script>
      let sessionId = null;
      const ALLOWED_MODELS = ${allowedModelsJson};
      let currentModel = ${initialModelJson};
      const chat = document.getElementById("chat");
      const promptEl = document.getElementById("prompt");
      const sendBtn = document.getElementById("sendBtn");
      const newBtn = document.getElementById("newBtn");
      const statusEl = document.getElementById("status");
      const modelSelectEl = document.getElementById("modelSelect");
      const modelMetaEl = document.getElementById("modelMeta");

      window.addEventListener("error", (e) => {
        statusEl.textContent = "Client error: " + e.message;
      });

      function updateModelMeta(model) {
        modelMetaEl.textContent = "Model: " + model;
      }

      function renderModelOptions(models, selectedModel) {
        modelSelectEl.innerHTML = "";
        for (const model of models) {
          const option = document.createElement("option");
          option.value = model;
          option.textContent = model;
          option.selected = model === selectedModel;
          modelSelectEl.appendChild(option);
        }
      }

      async function loadModels() {
        try {
          const res = await fetch("/api/models");
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || "Failed to load model list");
          }

          const models = Array.isArray(data.models) && data.models.length
            ? data.models
            : ALLOWED_MODELS;

          currentModel = data.model || currentModel;
          renderModelOptions(models, currentModel);
          updateModelMeta(currentModel);
        } catch (error) {
          renderModelOptions(ALLOWED_MODELS, currentModel);
          statusEl.textContent = "Model list unavailable: " + error.message;
        }
      }

      async function changeModel(model) {
        if (!model || model === currentModel) return;

        modelSelectEl.disabled = true;
        statusEl.textContent = "Switching model to " + model + "...";

        try {
          const res = await fetch("/api/model", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model }),
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || "Failed to switch model");
          }

          currentModel = data.model;
          updateModelMeta(currentModel);
          modelSelectEl.value = currentModel;
          statusEl.textContent = "Model switched: " + currentModel;
        } catch (error) {
          modelSelectEl.value = currentModel;
          statusEl.textContent = "Model switch failed: " + error.message;
        } finally {
          modelSelectEl.disabled = false;
        }
      }

      function formatEvents(events) {
        return events.map((event) => {
          if (event.type === "tool_start") {
            return "[tool:start] " + event.name + " args=" + event.args;
          }

          if (event.type === "tool_end") {
            return "[tool:end] " + event.name + " ok=" + event.ok + "\\n" + event.output;
          }

          return JSON.stringify(event, null, 2);
        }).join("\\n\\n");
      }

      function addMessage(kind, text, events = []) {
        const div = document.createElement("div");
        div.className = "msg " + kind;

        const labelEl = document.createElement("div");
        labelEl.className = "msg-label";
        labelEl.textContent = kind === "user" ? "You" : "Agent";

        const bodyEl = document.createElement("div");
        bodyEl.textContent = text || "";

        div.appendChild(labelEl);
        div.appendChild(bodyEl);

        if (Array.isArray(events) && events.length) {
          const hasFailure = events.some(
            (event) => event && event.type === "tool_end" && event.ok === false,
          );

          const detailsEl = document.createElement("details");
          detailsEl.className = "events";
          if (hasFailure) {
            detailsEl.open = true;
          }

          const summaryEl = document.createElement("summary");
          summaryEl.textContent = hasFailure
            ? "Tool activity (attention needed)"
            : "Tool activity";

          const preEl = document.createElement("pre");
          preEl.textContent = formatEvents(events);

          detailsEl.appendChild(summaryEl);
          detailsEl.appendChild(preEl);
          div.appendChild(detailsEl);
        }

        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
      }

      async function sendPrompt() {
        const message = promptEl.value.trim();
        if (!message) return;

        addMessage("user", message);
        promptEl.value = "";
        sendBtn.disabled = true;
        statusEl.textContent = "Thinking...";

        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId, message }),
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || "Request failed");
          }

          sessionId = data.sessionId;
          if (data.model) {
            currentModel = data.model;
            updateModelMeta(currentModel);
            modelSelectEl.value = currentModel;
          }

          addMessage("assistant", data.reply, data.events || []);
          statusEl.textContent = "Session: " + sessionId;
        } catch (error) {
          addMessage("assistant", "Error: " + error.message);
          statusEl.textContent = "Error";
        } finally {
          sendBtn.disabled = false;
          promptEl.focus();
        }
      }

      async function newSession() {
        sessionId = null;
        chat.innerHTML = "";
        statusEl.textContent = "New session ready.";
      }

      window.__sendPrompt = sendPrompt;
      window.__newSession = newSession;

      sendBtn.addEventListener("click", sendPrompt);
      newBtn.addEventListener("click", newSession);
      modelSelectEl.addEventListener("change", (event) => {
        const value = event.target && event.target.value;
        changeModel(value);
      });
      promptEl.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          sendPrompt();
        }
      });

      loadModels();
    </script>
  </body>
</html>`;
}

function startGeminiWebServer(options = {}) {
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

  const fallbackModel = "gemini-3-flash-preview";
  let currentModel = ALLOWED_MODELS.includes(runtime.model)
    ? runtime.model
    : fallbackModel;

  if (currentModel !== runtime.model) {
    serverLogger.warn("unsupported_startup_model", {
      requestedModel: runtime.model,
      fallbackModel,
      allowedModels: ALLOWED_MODELS,
    });
  }

  let agent = createGeminiAgent({
    rootDir,
    apiKey: runtime.apiKey,
    model: currentModel,
    maxTurns: runtime.maxTurns,
    maxToolCalls: runtime.maxToolCalls,
    commandTimeoutMs: runtime.commandTimeoutMs,
    allowOutsideRoot: runtime.allowOutsideRoot,
    logger: logger.child({ component: "agent" }),
  });

  serverLogger.info("server_boot", {
    rootDir,
    model: currentModel,
    port: runtime.port,
    maxTurns: runtime.maxTurns,
    maxToolCalls: runtime.maxToolCalls,
    commandTimeoutMs: runtime.commandTimeoutMs,
    allowedModels: ALLOWED_MODELS,
    allowOutsideRoot: runtime.allowOutsideRoot,
    logFile: logger.getLogFilePath(),
  });

  const sessions = new Map();

  function getOrCreateSession(requestedId) {
    if (requestedId && sessions.has(requestedId)) {
      const existing = sessions.get(requestedId);
      if (!existing.currentDir) {
        existing.currentDir = rootDir;
      }
      return existing;
    }

    const id = crypto.randomUUID();
    const session = {
      id,
      contents: [],
      totalToolCalls: 0,
      currentDir: rootDir,
    };
    sessions.set(id, session);
    return session;
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
      if (req.method === "GET" && url === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(buildHtml(currentModel, ALLOWED_MODELS));
        reqLogger.info("http_request_end", { status: 200 });
        return;
      }

      if (req.method === "GET" && url === "/api/health") {
        sendJson(res, 200, {
          ok: true,
          model: currentModel,
          maxTurns: runtime.maxTurns,
          maxToolCalls: runtime.maxToolCalls,
          commandTimeoutMs: runtime.commandTimeoutMs,
          allowedModels: ALLOWED_MODELS,
        });
        reqLogger.info("http_request_end", { status: 200, route: "health" });
        return;
      }

      if (req.method === "GET" && url === "/api/models") {
        sendJson(res, 200, {
          model: currentModel,
          models: ALLOWED_MODELS,
        });
        reqLogger.info("http_request_end", { status: 200, route: "models" });
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

        if (requestedModel !== currentModel) {
          currentModel = requestedModel;
          agent = createGeminiAgent({
            rootDir,
            apiKey: runtime.apiKey,
            model: currentModel,
            maxTurns: runtime.maxTurns,
            maxToolCalls: runtime.maxToolCalls,
            commandTimeoutMs: runtime.commandTimeoutMs,
            allowOutsideRoot: runtime.allowOutsideRoot,
            logger: logger.child({ component: "agent" }),
          });

          reqLogger.info("model_switched", {
            model: currentModel,
          });
        }

        sendJson(res, 200, {
          ok: true,
          model: currentModel,
          models: ALLOWED_MODELS,
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
        const result = await agent.sendMessage(session, message);

        sendJson(res, 200, {
          sessionId: session.id,
          currentDir: session.currentDir,
          model: currentModel,
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

  server.listen(runtime.port, () => {
    console.log(`Local Code Agent running at http://localhost:${runtime.port}`);
    console.log(`Model: ${currentModel}`);
    console.log(`Max turns: ${runtime.maxTurns}`);
    console.log(`Max tool calls: ${runtime.maxToolCalls}`);
    console.log(`Command timeout ms: ${runtime.commandTimeoutMs}`);
    console.log(`Logs: ${logger.getLogFilePath() || "disabled"}`);
    if (runtime.allowOutsideRoot) {
      console.log("Outside-root file access: enabled");
    }
    console.log("Tip: Use Ctrl/Cmd+Enter to send quickly from the textarea.");
  });
}

module.exports = {
  startGeminiWebServer,
};
