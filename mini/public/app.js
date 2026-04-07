/* global __ALLOWED_MODELS__, __INITIAL_MODEL__, __AUTH_TOKEN__ */
// These globals are injected by the server into index.html at serve time.

let sessionId = null;
const ALLOWED_MODELS = __ALLOWED_MODELS__;
const AUTH_TOKEN = __AUTH_TOKEN__;
const authHeaders = { authorization: "Bearer " + AUTH_TOKEN };
const SETTINGS_STORAGE_KEY = "gemini-web-settings-v1";

let currentSettings = null;
let defaultSettings = null;
let isHydratingSettingsUI = false;
let settingsSaveTimer = null;
let settingsRequestNonce = 0;

const chat = document.getElementById("chat");
const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("sendBtn");
const newBtn = document.getElementById("newBtn");
const exportBtn = document.getElementById("exportBtn");
const statusEl = document.getElementById("status");
const modelMetaEl = document.getElementById("modelMeta");
const appEl = document.querySelector(".app");
const onboardingEl = document.getElementById("onboarding");
const onboardingCapabilitiesEl = document.getElementById(
  "onboardingCapabilities",
);
const composerEl = document.getElementById("composer");

const drawerEl = document.getElementById("settingsDrawer");
const drawerBackdropEl = document.getElementById("drawerBackdrop");
const settingsToggleBtn = document.getElementById("settingsToggleBtn");
const settingsResetBtn = document.getElementById("settingsResetBtn");
const settingsSaveStateEl = document.getElementById("settingsSaveState");

const COMPOSER_DOCK_ANIMATION_MS = 1100;
const reducedMotionQuery = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
);
let sessionHasUserMessages = false;

const ONBOARDING_PROMPTS_PER_SESSION = 5;
const ONBOARDING_PROMPT_LIBRARY = [
  "Find the real Desktop folder and create an empty names.txt file there.",
  "Create a new todo.md in this workspace with sections for Bugs, Features, and Notes.",
  'Open README.md and add a short "Quick Start" section if it is missing.',
  "Search this repo for TODO comments and summarize the top 10 by impact.",
  "Find where sendPrompt is defined and explain how messages flow to the backend.",
  "Navigate to mini/public and list the files that control UI layout and styles.",
  "Run a fast search for onboarding and show every file touching onboarding behavior.",
  "Check git status and summarize unstaged changes in plain English.",
  "Show the diff for mini/public/app.js and explain what behavior changed.",
  "Export the latest session and provide a short index of keys in the JSON.",
  "Find all range sliders in the UI and list their IDs with min and max values.",
  "Locate where New Session is implemented and describe exactly what state is reset.",
  "Create a scratch file named investigation-notes.txt on Desktop and write one line into it.",
  "Search for hard-coded colors in mini/public/style.css and suggest which should become tokens.",
  "Run a command to list top-level folders and explain what each appears to do.",
  "Find all fetch calls in mini/public/app.js and summarize the API endpoints used.",
  "Locate where model settings are loaded and persisted between refreshes.",
  "Create docs/ui-prompts.md and draft 8 useful starter prompts for this project.",
  "Find references to GEMINI_ALLOW_OUTSIDE_ROOT and explain path safety behavior.",
  "Summarize the last 5 commits that touched files under mini/public.",
  "Check for TypeScript errors in the workspace and return the first 5 actionable issues.",
  "Scan commands/ for anything related to review and list command names.",
  "Find where tool_start and tool_end events are rendered in the chat UI.",
  "Add a brief comment above armOnboardingComposer explaining why it resets sessionHasUserMessages.",
  "Identify CSS selectors in mini/public/style.css that are not used by index.html.",
  "Run a search for settingsResetBtn and map the reset flow end-to-end.",
  "Compare index.html and app.js onboarding logic and note any mismatch.",
  "Create desktop-path-check.txt on Desktop with the detected absolute path.",
  "Find all keyboard shortcuts in the web UI and summarize how each is triggered.",
  "Show the exact code path that handles Ctrl+Enter message sending.",
  "List every environment variable documented for gemini-web and what each controls.",
  "Find where markdown rendering happens in the chat and note any sanitization risks.",
  "Run a quick security pass for file-write operations and summarize safeguards.",
  "Generate a short changelog entry for today's UI updates in CHANGELOG.md.",
  "Search for accent-color and propose a cohesive green palette for this dark theme.",
  "Find all onboarding strings and prepare them for future i18n extraction.",
  "Create a minimal reproduction note for any bug found in new session reset behavior.",
  "Trace how sessionId is created, stored, and reused across requests.",
  "List all buttons in the header and explain their click handlers.",
  "Summarize tool activity formatting and where failed tool calls are highlighted.",
  "Find duplicated logic between send button click and keyboard send handlers.",
  "Run a quick repo inventory and provide counts of ts, tsx, js, and css files.",
];

const controls = {
  model: document.getElementById("settingModel"),
  temperature: document.getElementById("settingTemperature"),
  temperatureValue: document.getElementById("settingTemperatureValue"),
  topP: document.getElementById("settingTopP"),
  topPValue: document.getElementById("settingTopPValue"),
  topK: document.getElementById("settingTopK"),
  topKValue: document.getElementById("settingTopKValue"),
  maxOutputTokens: document.getElementById("settingMaxOutputTokens"),
  maxOutputTokensValue: document.getElementById("settingMaxOutputTokensValue"),
  thinkingMode: document.getElementById("settingThinkingMode"),
  thinkingBudget: document.getElementById("settingThinkingBudget"),
  thinkingBudgetValue: document.getElementById("settingThinkingBudgetValue"),
  systemPrompt: document.getElementById("settingSystemPrompt"),
  maxTurns: document.getElementById("settingMaxTurns"),
  maxTurnsValue: document.getElementById("settingMaxTurnsValue"),
  maxToolCalls: document.getElementById("settingMaxToolCalls"),
  maxToolCallsValue: document.getElementById("settingMaxToolCallsValue"),
  commandTimeoutMs: document.getElementById("settingCommandTimeoutMs"),
  commandTimeoutMsValue: document.getElementById(
    "settingCommandTimeoutMsValue",
  ),
  allowOutsideRoot: document.getElementById("settingAllowOutsideRoot"),
};

function smoothScrollToBottom() {
  chat.scrollTo({ top: chat.scrollHeight, behavior: "smooth" });
}

function prefersReducedMotion() {
  return reducedMotionQuery.matches;
}

function setComposerLayout(mode) {
  const isCentered = mode === "centered";
  appEl.classList.toggle("composer-centered", isCentered);
  appEl.classList.toggle("composer-docked", !isCentered);
  onboardingEl.setAttribute("aria-hidden", String(!isCentered));
  onboardingEl.inert = !isCentered;
}

function dockComposerFromOnboarding() {
  if (!appEl.classList.contains("composer-centered")) {
    return;
  }

  const startRect = composerEl.getBoundingClientRect();
  setComposerLayout("docked");

  if (prefersReducedMotion()) {
    return;
  }

  const endRect = composerEl.getBoundingClientRect();
  const translateX = startRect.left - endRect.left;
  const translateY = startRect.top - endRect.top;

  composerEl.animate(
    [
      {
        transform: `translate(${translateX}px, ${translateY}px) scale(0.99)`,
        opacity: 0.94,
      },
      {
        transform: "translate(0px, 0px) scale(1)",
        opacity: 1,
      },
    ],
    {
      duration: COMPOSER_DOCK_ANIMATION_MS,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "none",
    },
  );
}

function armOnboardingComposer() {
  sessionHasUserMessages = false;
  renderOnboardingPrompts();
  setComposerLayout("centered");
}

function markSessionActivatedByFirstPrompt() {
  if (sessionHasUserMessages) {
    return;
  }

  sessionHasUserMessages = true;
  dockComposerFromOnboarding();
}

function updateModelMeta(model) {
  modelMetaEl.textContent = "Model: " + model;
}

function setSaveState(text, tone) {
  settingsSaveStateEl.textContent = text;
  settingsSaveStateEl.dataset.tone = tone || "neutral";
}

function updateDrawerToggleState(isOpen) {
  settingsToggleBtn.textContent = isOpen ? "\u2190" : "\u2192";
  settingsToggleBtn.setAttribute(
    "aria-label",
    isOpen ? "Close settings panel" : "Open settings panel",
  );
  settingsToggleBtn.setAttribute("aria-expanded", String(isOpen));
  settingsToggleBtn.title = isOpen ? "Close settings" : "Open settings";
}

function setDrawerOpen(isOpen) {
  drawerEl.classList.toggle("open", isOpen);
  drawerEl.setAttribute("aria-hidden", String(!isOpen));
  drawerBackdropEl.hidden = !isOpen;
  document.body.classList.toggle("drawer-open", isOpen);
  updateDrawerToggleState(isOpen);
  if (isOpen) {
    controls.model.focus();
  }
}

function renderModelOptions(models, selectedModel) {
  controls.model.innerHTML = "";
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    option.selected = model === selectedModel;
    controls.model.appendChild(option);
  }
}

function sampleOnboardingPrompts(pool, count) {
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    const temp = shuffled[i];
    shuffled[i] = shuffled[swapIndex];
    shuffled[swapIndex] = temp;
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function renderOnboardingPrompts() {
  if (!onboardingCapabilitiesEl) {
    return;
  }

  onboardingCapabilitiesEl.innerHTML = "";
  const prompts = sampleOnboardingPrompts(
    ONBOARDING_PROMPT_LIBRARY,
    ONBOARDING_PROMPTS_PER_SESSION,
  );

  for (const prompt of prompts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "onboarding-capability";
    button.setAttribute("role", "listitem");
    button.dataset.prompt = prompt;
    button.textContent = prompt;
    onboardingCapabilitiesEl.appendChild(button);
  }
}

function readPersistedSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function persistSettings(settings) {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore quota or storage lock issues.
  }
}

function clearPersistedSettings() {
  try {
    window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function renderSettingValues() {
  controls.temperatureValue.textContent = Number(
    controls.temperature.value,
  ).toFixed(2);
  controls.topPValue.textContent = Number(controls.topP.value).toFixed(2);
  controls.topKValue.textContent = String(
    Math.round(Number(controls.topK.value)),
  );
  controls.maxOutputTokensValue.textContent = String(
    Math.round(Number(controls.maxOutputTokens.value)),
  );
  controls.thinkingBudgetValue.textContent = String(
    Math.round(Number(controls.thinkingBudget.value)),
  );
  controls.maxTurnsValue.textContent = String(
    Math.round(Number(controls.maxTurns.value)),
  );
  controls.maxToolCallsValue.textContent = String(
    Math.round(Number(controls.maxToolCalls.value)),
  );
  controls.commandTimeoutMsValue.textContent = String(
    Math.round(Number(controls.commandTimeoutMs.value)),
  );

  const thinkingMode = controls.thinkingMode.value;
  controls.thinkingBudget.disabled = thinkingMode === "disabled";
}

function applySettingsToControls(settings) {
  isHydratingSettingsUI = true;

  controls.model.value = settings.model;
  controls.temperature.value = String(settings.temperature);
  controls.topP.value = String(settings.topP);
  controls.topK.value = String(settings.topK);
  controls.maxOutputTokens.value = String(settings.maxOutputTokens);
  controls.thinkingMode.value = settings.thinkingMode;
  controls.thinkingBudget.value = String(settings.thinkingBudget);
  controls.systemPrompt.value = settings.systemPrompt || "";
  controls.maxTurns.value = String(settings.maxTurns);
  controls.maxToolCalls.value = String(settings.maxToolCalls);
  controls.commandTimeoutMs.value = String(settings.commandTimeoutMs);
  controls.allowOutsideRoot.checked = !!settings.allowOutsideRoot;

  renderSettingValues();
  updateModelMeta(settings.model);

  isHydratingSettingsUI = false;
}

function collectSettingsFromControls() {
  return {
    model: controls.model.value,
    temperature: Number(controls.temperature.value),
    topP: Number(controls.topP.value),
    topK: Math.round(Number(controls.topK.value)),
    maxOutputTokens: Math.round(Number(controls.maxOutputTokens.value)),
    thinkingMode: controls.thinkingMode.value,
    thinkingBudget: Math.round(Number(controls.thinkingBudget.value)),
    systemPrompt: controls.systemPrompt.value,
    maxTurns: Math.round(Number(controls.maxTurns.value)),
    maxToolCalls: Math.round(Number(controls.maxToolCalls.value)),
    commandTimeoutMs: Math.round(Number(controls.commandTimeoutMs.value)),
    allowOutsideRoot: !!controls.allowOutsideRoot.checked,
  };
}

async function postSettings(payload, options = {}) {
  const nonce = ++settingsRequestNonce;
  if (!options.silent) {
    setSaveState("Saving...", "saving");
  }

  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || "Failed to update settings");
  }

  if (nonce !== settingsRequestNonce) {
    return;
  }

  currentSettings = data.settings;
  if (data.defaults) {
    defaultSettings = data.defaults;
  }
  applySettingsToControls(currentSettings);
  persistSettings(currentSettings);

  if (!options.silent) {
    setSaveState("Saved", "ok");
    setTimeout(() => {
      if (settingsSaveStateEl.dataset.tone === "ok") {
        setSaveState("Ready", "neutral");
      }
    }, 900);
  }
}

function scheduleSettingsSave(delayMs) {
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(async () => {
    try {
      await postSettings(collectSettingsFromControls());
      statusEl.textContent = "Settings updated.";
    } catch (error) {
      setSaveState("Save failed", "error");
      statusEl.textContent = "Settings update failed: " + error.message;
    }
  }, delayMs);
}

async function loadSettings() {
  setSaveState("Loading...", "neutral");
  const res = await fetch("/api/settings", { headers: authHeaders });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to load settings");
  }

  defaultSettings = data.defaults || null;
  currentSettings = data.settings;

  const models =
    Array.isArray(data.allowedModels) && data.allowedModels.length
      ? data.allowedModels
      : ALLOWED_MODELS;
  renderModelOptions(models, currentSettings.model);

  const persisted = readPersistedSettings();
  if (persisted) {
    applySettingsToControls({ ...currentSettings, ...persisted });
    try {
      await postSettings(collectSettingsFromControls(), { silent: true });
      statusEl.textContent = "Ready.";
    } catch (error) {
      statusEl.textContent = "Saved settings invalid: " + error.message;
      applySettingsToControls(currentSettings);
    }
  } else {
    applySettingsToControls(currentSettings);
  }

  setSaveState("Ready", "neutral");
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
    null,
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

async function sendPrompt(messageOverride) {
  const message =
    typeof messageOverride === "string"
      ? messageOverride.trim()
      : promptEl.value.trim();
  if (!message || sendBtn.disabled) return;

  markSessionActivatedByFirstPrompt();
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
    "<span>Thinking...</span>";

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
          try {
            event = JSON.parse(raw);
          } catch {
            continue;
          }

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
            item.innerHTML =
              '<span class="spinner"></span> ' + event.name + "...";
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
                  item.innerHTML =
                    '<span class="' + icon + '"></span> ' + event.name;
                  break;
                }
              }
            }
            smoothScrollToBottom();
            continue;
          }

          if (event.type === "thinking") {
            if (thinkingEl.parentNode) thinkingEl.remove();
            const thinkingDetails = document.createElement("details");
            thinkingDetails.className = "events thinking-content";
            const thinkingSummary = document.createElement("summary");
            thinkingSummary.textContent = "Thinking";
            const thinkingPre = document.createElement("pre");
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
  armOnboardingComposer();
  promptEl.value = "";
  promptEl.style.height = "auto";
  promptEl.focus();
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
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
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

function addSettingsEventListeners() {
  const saveNow = () => {
    if (isHydratingSettingsUI) return;
    renderSettingValues();
    scheduleSettingsSave(220);
  };

  controls.model.addEventListener("change", saveNow);
  controls.temperature.addEventListener("input", saveNow);
  controls.topP.addEventListener("input", saveNow);
  controls.topK.addEventListener("input", saveNow);
  controls.maxOutputTokens.addEventListener("input", saveNow);
  controls.thinkingMode.addEventListener("change", saveNow);
  controls.thinkingBudget.addEventListener("input", saveNow);
  controls.maxTurns.addEventListener("input", saveNow);
  controls.maxToolCalls.addEventListener("input", saveNow);
  controls.commandTimeoutMs.addEventListener("input", saveNow);
  controls.allowOutsideRoot.addEventListener("change", saveNow);

  controls.systemPrompt.addEventListener("input", () => {
    if (isHydratingSettingsUI) return;
    scheduleSettingsSave(600);
  });

  settingsResetBtn.addEventListener("click", async () => {
    try {
      await postSettings({ resetToDefaults: true });
      clearPersistedSettings();
      statusEl.textContent = "Settings reset to defaults.";
    } catch (error) {
      setSaveState("Reset failed", "error");
      statusEl.textContent = "Reset failed: " + error.message;
    }
  });

  settingsToggleBtn.addEventListener("click", () => {
    const willOpen = !drawerEl.classList.contains("open");
    setDrawerOpen(willOpen);
  });
  drawerBackdropEl.addEventListener("click", () => setDrawerOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawerEl.classList.contains("open")) {
      setDrawerOpen(false);
    }
  });
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
sendBtn.addEventListener("click", sendPrompt);
newBtn.addEventListener("click", newSession);
exportBtn.addEventListener("click", exportSession);
if (onboardingCapabilitiesEl) {
  onboardingCapabilitiesEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest(".onboarding-capability");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const prompt = button.dataset.prompt || "";
    if (!prompt.trim()) {
      return;
    }

    sendPrompt(prompt);
  });
}
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

armOnboardingComposer();
updateDrawerToggleState(false);
addSettingsEventListeners();
loadSettings().catch((error) => {
  setSaveState("Unavailable", "error");
  statusEl.textContent = "Settings load failed: " + error.message;
});
