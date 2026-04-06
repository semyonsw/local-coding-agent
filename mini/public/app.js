/* global __ALLOWED_MODELS__, __INITIAL_MODEL__, __AUTH_TOKEN__ */
// These globals are injected by the server into index.html at serve time.

let sessionId = null;
const ALLOWED_MODELS = __ALLOWED_MODELS__;
let currentModel = __INITIAL_MODEL__;
const AUTH_TOKEN = __AUTH_TOKEN__;
const authHeaders = { authorization: "Bearer " + AUTH_TOKEN };

const chat = document.getElementById("chat");
const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("sendBtn");
const newBtn = document.getElementById("newBtn");
const exportBtn = document.getElementById("exportBtn");
const statusEl = document.getElementById("status");
const modelSelectEl = document.getElementById("modelSelect");
const modelMetaEl = document.getElementById("modelMeta");

function smoothScrollToBottom() {
  chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
}

window.addEventListener("error", (e) => {
  statusEl.textContent = "Client error: " + e.message;
});

// ---------------------------------------------------------------------------
// Minimal markdown renderer (code blocks, inline code, bold, italic, links)
// ---------------------------------------------------------------------------
function renderMarkdown(text) {
  if (!text) return "";

  // Escape HTML
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Fenced code blocks: ```lang\n...\n```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const cls = lang ? ` class="language-${lang}"` : "";
    return `<pre><code${cls}>${code.trimEnd()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");

  // Links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );

  return html;
}

// ---------------------------------------------------------------------------
// Word-by-word reveal animation
// ---------------------------------------------------------------------------
function revealWordsProgressively(containerEl, onProgress) {
  const WORDS_PER_GROUP = 7;
  const INTERVAL_MS = 80;

  // Collect text nodes outside <pre> blocks
  const textNodes = [];
  const walker = document.createTreeWalker(
    containerEl,
    NodeFilter.SHOW_TEXT,
    null
  );
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement && node.parentElement.closest("pre")) continue;
    if (node.textContent.trim().length === 0) continue;
    textNodes.push(node);
  }

  // Split text nodes into word-group spans
  const wordGroups = [];

  for (const textNode of textNodes) {
    const words = textNode.textContent.split(/(\s+)/);
    const parent = textNode.parentNode;
    const fragment = document.createDocumentFragment();

    let wordCount = 0;
    let currentSpan = document.createElement("span");
    currentSpan.className = "word-group";

    for (const token of words) {
      if (/^\s+$/.test(token)) {
        currentSpan.appendChild(document.createTextNode(token));
      } else if (token.length > 0) {
        currentSpan.appendChild(document.createTextNode(token));
        wordCount++;
        if (wordCount >= WORDS_PER_GROUP) {
          wordGroups.push(currentSpan);
          fragment.appendChild(currentSpan);
          currentSpan = document.createElement("span");
          currentSpan.className = "word-group";
          wordCount = 0;
        }
      }
    }

    if (currentSpan.childNodes.length > 0) {
      wordGroups.push(currentSpan);
      fragment.appendChild(currentSpan);
    }

    parent.replaceChild(fragment, textNode);
  }

  // Progressively reveal
  let groupIndex = 0;

  function revealNext() {
    if (groupIndex >= wordGroups.length) {
      if (typeof onProgress === "function") onProgress(true);
      return;
    }

    wordGroups[groupIndex].classList.add("revealed");
    groupIndex++;

    if (typeof onProgress === "function") onProgress(false);
    requestAnimationFrame(function () {
      setTimeout(revealNext, INTERVAL_MS);
    });
  }

  if (wordGroups.length === 0) {
    if (typeof onProgress === "function") onProgress(true);
    return;
  }

  requestAnimationFrame(revealNext);
}

// ---------------------------------------------------------------------------
// Model controls
// ---------------------------------------------------------------------------
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
    const res = await fetch("/api/models", { headers: authHeaders });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to load model list");
    }

    const models =
      Array.isArray(data.models) && data.models.length
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
      headers: { ...authHeaders, "content-type": "application/json" },
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

// ---------------------------------------------------------------------------
// Chat messages
// ---------------------------------------------------------------------------
function formatEvents(events) {
  return events
    .map((event) => {
      if (event.type === "tool_start") {
        return "[tool:start] " + event.name + " args=" + event.args;
      }

      if (event.type === "tool_end") {
        return (
          "[tool:end] " + event.name + " ok=" + event.ok + "\n" + event.output
        );
      }

      return JSON.stringify(event, null, 2);
    })
    .join("\n\n");
}

function addMessage(kind, text, events) {
  events = events || [];

  const div = document.createElement("div");
  div.className = "msg " + kind;

  const labelEl = document.createElement("div");
  labelEl.className = "msg-label";
  labelEl.textContent = kind === "user" ? "You" : "Agent";

  const bodyEl = document.createElement("div");
  bodyEl.className = "msg-body";
  if (kind === "assistant") {
    bodyEl.innerHTML = renderMarkdown(text || "");
  } else {
    bodyEl.textContent = text || "";
  }

  div.appendChild(labelEl);
  div.appendChild(bodyEl);

  if (Array.isArray(events) && events.length) {
    const hasFailure = events.some(
      (event) => event && event.type === "tool_end" && event.ok === false,
    );

    const detailsEl = document.createElement("details");
    detailsEl.className = "events";

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
  smoothScrollToBottom();
}

// ---------------------------------------------------------------------------
// SSE stream parser
// ---------------------------------------------------------------------------
function parseSSELines(text) {
  const events = [];
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      events.push(line.slice(6));
    }
  }
  return events;
}

async function sendPrompt() {
  const message = promptEl.value.trim();
  if (!message) return;

  addMessage("user", message);
  promptEl.value = "";
  promptEl.style.height = "auto";
  sendBtn.disabled = true;
  statusEl.textContent = "Thinking...";

  // Create a placeholder assistant message with live tool activity area
  const msgDiv = document.createElement("div");
  msgDiv.className = "msg assistant";
  const labelEl = document.createElement("div");
  labelEl.className = "msg-label";
  labelEl.textContent = "Agent";
  const bodyEl = document.createElement("div");
  bodyEl.className = "msg-body";
  bodyEl.textContent = "";
  const activityEl = document.createElement("div");
  activityEl.className = "tool-activity";
  activityEl.style.display = "none";

  const thinkingEl = document.createElement("div");
  thinkingEl.className = "thinking-indicator";
  thinkingEl.innerHTML =
    '<div class="thinking-dots"><span></span><span></span><span></span></div>' +
    '<span>Thinking...</span>';

  msgDiv.appendChild(labelEl);
  msgDiv.appendChild(bodyEl);
  msgDiv.appendChild(activityEl);
  msgDiv.appendChild(thinkingEl);
  chat.appendChild(msgDiv);
  smoothScrollToBottom();

  const collectedEvents = [];
  const toolItems = new Map(); // name -> DOM element

  try {
    const res = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({ sessionId, message }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "Request failed (" + res.status + ")");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const sseEvents = parseSSELines(part);
        for (const raw of sseEvents) {
          if (raw === "[DONE]") continue;

          let event;
          try { event = JSON.parse(raw); } catch { continue; }

          if (event.type === "session") {
            sessionId = event.sessionId;
            statusEl.textContent = "Session: " + sessionId;
            continue;
          }

          if (event.type === "tool_start") {
            collectedEvents.push(event);
            activityEl.style.display = "";
            const item = document.createElement("div");
            item.className = "tool-item";
            item.innerHTML = '<span class="spinner"></span> ' + event.name + "...";
            activityEl.appendChild(item);
            toolItems.set(event.name + "_" + collectedEvents.length, item);
            smoothScrollToBottom();
            continue;
          }

          if (event.type === "tool_end") {
            collectedEvents.push(event);
            // Find the most recent matching tool_start item
            const keys = [...toolItems.keys()];
            for (let i = keys.length - 1; i >= 0; i--) {
              if (keys[i].startsWith(event.name + "_")) {
                const item = toolItems.get(keys[i]);
                if (item && item.querySelector(".spinner")) {
                  const icon = event.ok ? "icon-ok" : "icon-fail";
                  item.innerHTML = '<span class="' + icon + '"></span> ' + event.name;
                  break;
                }
              }
            }
            smoothScrollToBottom();
            continue;
          }

          if (event.type === "thinking") {
            if (thinkingEl.parentNode) thinkingEl.remove();
            var thinkingDetails = document.createElement("details");
            thinkingDetails.className = "events thinking-content";
            var thinkingSummary = document.createElement("summary");
            thinkingSummary.textContent = "Thinking";
            var thinkingPre = document.createElement("pre");
            thinkingPre.textContent = event.text;
            thinkingDetails.appendChild(thinkingSummary);
            thinkingDetails.appendChild(thinkingPre);
            msgDiv.insertBefore(thinkingDetails, bodyEl);
            smoothScrollToBottom();
            continue;
          }

          if (event.type === "text") {
            if (thinkingEl.parentNode) thinkingEl.remove();
            bodyEl.innerHTML = renderMarkdown(event.text || "");
            revealWordsProgressively(bodyEl, function () {
              smoothScrollToBottom();
            });
            continue;
          }

          if (event.type === "error") {
            bodyEl.textContent = "Error: " + (event.message || "Unknown error");
            continue;
          }

          if (event.type === "done") {
            statusEl.textContent = "Session: " + (event.sessionId || sessionId);
            continue;
          }
        }
      }
    }

    // Remove thinking indicator
    if (thinkingEl.parentNode) thinkingEl.remove();

    // Convert live tool activity into the collapsible details accordion
    if (collectedEvents.length > 0) {
      activityEl.remove();
      const hasFailure = collectedEvents.some(
        (e) => e.type === "tool_end" && e.ok === false,
      );
      const detailsEl = document.createElement("details");
      detailsEl.className = "events";
      const summaryEl = document.createElement("summary");
      summaryEl.textContent = hasFailure
        ? "Tool activity (attention needed)"
        : "Tool activity";
      const preEl = document.createElement("pre");
      preEl.textContent = formatEvents(collectedEvents);
      detailsEl.appendChild(summaryEl);
      detailsEl.appendChild(preEl);
      msgDiv.appendChild(detailsEl);
    } else {
      activityEl.remove();
    }
  } catch (error) {
    bodyEl.textContent = "Error: " + error.message;
    if (thinkingEl.parentNode) thinkingEl.remove();
    activityEl.remove();
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

async function exportSession() {
  if (!sessionId) {
    statusEl.textContent = "No active session to export.";
    return;
  }
  try {
    const res = await fetch("/api/sessions/" + sessionId + "/export", {
      headers: authHeaders,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Export failed");
    }
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "session-" + sessionId.slice(0, 8) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    statusEl.textContent = "Session exported.";
  } catch (error) {
    statusEl.textContent = "Export failed: " + error.message;
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
sendBtn.addEventListener("click", sendPrompt);
newBtn.addEventListener("click", newSession);
exportBtn.addEventListener("click", exportSession);
modelSelectEl.addEventListener("change", (event) => {
  const value = event.target && event.target.value;
  changeModel(value);
});
promptEl.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    sendPrompt();
  }
});

// Auto-resize textarea to fit content
promptEl.addEventListener("input", () => {
  promptEl.style.height = "auto";
  promptEl.style.height = Math.min(promptEl.scrollHeight, 160) + "px";
});

loadModels();
