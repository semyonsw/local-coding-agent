const http = require("http");
const path = require("path");
const crypto = require("crypto");

const { getGeminiRuntimeConfig } = require("./gemini-env");
const { createGeminiAgent } = require("./gemini-agent");
const { createLogger } = require("./gemini-logger");

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

function buildHtml(model) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Gemini Web Agent</title>
    <style>
      :root {
        --bg-a: #131f38;
        --bg-b: #0e1627;
        --card: #121a2c;
        --line: #2a3650;
        --text: #ecf2ff;
        --muted: #9fb1cf;
        --accent: #00b48f;
        --accent-2: #2d8cff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", "Noto Sans", sans-serif;
        color: var(--text);
        background: radial-gradient(1400px 500px at 20% 0%, var(--bg-a), transparent 60%),
                    radial-gradient(1000px 500px at 90% 0%, var(--bg-b), transparent 50%),
                    #090f1d;
      }
      .wrap {
        max-width: 980px;
        margin: 28px auto;
        padding: 0 16px;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 14px;
      }
      .title {
        font-size: 22px;
        font-weight: 700;
        letter-spacing: 0.2px;
      }
      .meta {
        color: var(--muted);
        font-size: 13px;
      }
      .panel {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 14px;
        overflow: hidden;
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
      }
      .chat {
        height: 58vh;
        min-height: 360px;
        overflow: auto;
        padding: 16px;
      }
      .msg {
        margin-bottom: 12px;
        padding: 10px 12px;
        border-radius: 10px;
        white-space: pre-wrap;
      }
      .user { background: #1f3f70; border: 1px solid #3566af; }
      .assistant { background: #153c35; border: 1px solid #2f6f65; }
      .events {
        margin-top: 6px;
        padding: 8px;
        background: #0e1524;
        border: 1px dashed #3a4b69;
        border-radius: 8px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        color: #c4d4f4;
      }
      .composer {
        border-top: 1px solid var(--line);
        padding: 12px;
        display: grid;
        grid-template-columns: 1fr auto auto;
        gap: 8px;
      }
      textarea {
        width: 100%;
        resize: vertical;
        min-height: 64px;
        max-height: 220px;
        padding: 10px;
        border: 1px solid #3a4f75;
        background: #0c1527;
        color: var(--text);
        border-radius: 10px;
        font: inherit;
      }
      textarea::placeholder {
        color: #7f93b8;
      }
      textarea:focus-visible {
        outline: 2px solid #5ca5ff;
        outline-offset: 1px;
      }
      button {
        border: 0;
        border-radius: 10px;
        padding: 0 14px;
        font-weight: 600;
        cursor: pointer;
        color: white;
      }
      #sendBtn { background: var(--accent-2); color: white; }
      #newBtn { background: var(--accent); color: white; }
      button:hover {
        filter: brightness(1.1);
      }
      button:focus-visible {
        outline: 2px solid #7ab8ff;
        outline-offset: 1px;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      .status {
        padding: 8px 12px;
        font-size: 13px;
        color: var(--muted);
        border-top: 1px solid var(--line);
      }
      @media (max-width: 700px) {
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
    <div class="wrap">
      <div class="header">
        <div>
          <div class="title">Gemini Web Agent</div>
          <div class="meta">Model: ${model}</div>
        </div>
      </div>

      <div class="panel">
        <div id="chat" class="chat"></div>
        <div class="composer">
          <textarea id="prompt" placeholder="Ask about code, request file edits, or run repo commands..."></textarea>
          <button id="sendBtn" type="button" onclick="window.__sendPrompt && window.__sendPrompt()">Send</button>
          <button id="newBtn" type="button" onclick="window.__newSession && window.__newSession()">New Session</button>
        </div>
        <div id="status" class="status">Ready.</div>
      </div>
    </div>

    <script>
      let sessionId = null;
      const chat = document.getElementById("chat");
      const promptEl = document.getElementById("prompt");
      const sendBtn = document.getElementById("sendBtn");
      const newBtn = document.getElementById("newBtn");
      const statusEl = document.getElementById("status");

      window.addEventListener("error", (e) => {
        statusEl.textContent = "Client error: " + e.message;
      });

      function escapeHtml(text) {
        return String(text)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;");
      }

      function addMessage(kind, text, events) {
        const div = document.createElement("div");
        div.className = "msg " + kind;
        div.innerHTML = "<strong>" + (kind === "user" ? "You" : "Agent") + "</strong>\\n" + escapeHtml(text || "");

        if (Array.isArray(events) && events.length) {
          const eventsDiv = document.createElement("div");
          eventsDiv.className = "events";
          eventsDiv.textContent = events.map((e) => {
            if (e.type === "tool_start") {
              return "[tool:start] " + e.name + " args=" + e.args;
            }
            if (e.type === "tool_end") {
              return "[tool:end] " + e.name + " ok=" + e.ok + "\\n" + e.output;
            }
            return JSON.stringify(e);
          }).join("\\n\\n");
          div.appendChild(eventsDiv);
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
      promptEl.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          sendPrompt();
        }
      });
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

  serverLogger.info("server_boot", {
    rootDir,
    model: runtime.model,
    port: runtime.port,
    allowOutsideRoot: runtime.allowOutsideRoot,
    logFile: logger.getLogFilePath(),
  });

  const agent = createGeminiAgent({
    rootDir,
    apiKey: runtime.apiKey,
    model: runtime.model,
    maxTurns: runtime.maxTurns,
    maxToolCalls: runtime.maxToolCalls,
    commandTimeoutMs: runtime.commandTimeoutMs,
    allowOutsideRoot: runtime.allowOutsideRoot,
    logger: logger.child({ component: "agent" }),
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
        res.end(buildHtml(runtime.model));
        reqLogger.info("http_request_end", { status: 200 });
        return;
      }

      if (req.method === "GET" && url === "/api/health") {
        sendJson(res, 200, { ok: true, model: runtime.model });
        reqLogger.info("http_request_end", { status: 200, route: "health" });
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
    console.log(`Gemini web agent running at http://localhost:${runtime.port}`);
    console.log(`Model: ${runtime.model}`);
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
