const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../gemini-web");

const { normalizeSettingsUpdate } = __test;

function makeSettings() {
  return {
    model: "gemini-3-flash-preview",
    temperature: 0.2,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
    thinkingMode: "adaptive",
    thinkingBudget: 0,
    systemPrompt: "",
    maxTurns: 10,
    maxToolCalls: 20,
    commandTimeoutMs: 15000,
    allowOutsideRoot: false,
  };
}

const ALLOWED_MODELS = [
  "gemini-3-pro-preview",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
];

describe("normalizeSettingsUpdate", () => {
  it("applies updates and clamps numeric values to bounds", () => {
    const next = normalizeSettingsUpdate(
      makeSettings(),
      {
        model: "gemini-3-pro-preview",
        temperature: 9,
        topP: -2,
        topK: 999,
        maxOutputTokens: 100000,
        thinkingMode: "enabled",
        thinkingBudget: 999999,
        maxTurns: 999,
        maxToolCalls: 999,
        commandTimeoutMs: 999999,
        allowOutsideRoot: true,
      },
      ALLOWED_MODELS,
    );

    assert.equal(next.model, "gemini-3-pro-preview");
    assert.equal(next.temperature, 2);
    assert.equal(next.topP, 0);
    assert.equal(next.topK, 200);
    assert.equal(next.maxOutputTokens, 65536);
    assert.equal(next.thinkingMode, "enabled");
    assert.equal(next.thinkingBudget, 32768);
    assert.equal(next.maxTurns, 200);
    assert.equal(next.maxToolCalls, 200);
    assert.equal(next.commandTimeoutMs, 60000);
    assert.equal(next.allowOutsideRoot, true);
  });

  it("coerces string numbers and booleans", () => {
    const next = normalizeSettingsUpdate(
      makeSettings(),
      {
        temperature: "1.25",
        topP: "0.4",
        topK: "27",
        maxOutputTokens: "2048",
        thinkingBudget: "1536",
        maxTurns: "44",
        maxToolCalls: "55",
        commandTimeoutMs: "19000",
        allowOutsideRoot: "yes",
      },
      ALLOWED_MODELS,
    );

    assert.equal(next.temperature, 1.25);
    assert.equal(next.topP, 0.4);
    assert.equal(next.topK, 27);
    assert.equal(next.maxOutputTokens, 2048);
    assert.equal(next.thinkingBudget, 1536);
    assert.equal(next.maxTurns, 44);
    assert.equal(next.maxToolCalls, 55);
    assert.equal(next.commandTimeoutMs, 19000);
    assert.equal(next.allowOutsideRoot, true);
  });

  it("rejects unsupported model", () => {
    assert.throws(
      () =>
        normalizeSettingsUpdate(
          makeSettings(),
          { model: "gemini-unknown" },
          ALLOWED_MODELS,
        ),
      /allowed Gemini options/,
    );
  });

  it("rejects invalid thinking mode", () => {
    assert.throws(
      () =>
        normalizeSettingsUpdate(
          makeSettings(),
          { thinkingMode: "always" },
          ALLOWED_MODELS,
        ),
      /adaptive, enabled, or disabled/,
    );
  });

  it("truncates oversized system prompt", () => {
    const oversized = "x".repeat(14000);
    const next = normalizeSettingsUpdate(
      makeSettings(),
      { systemPrompt: oversized },
      ALLOWED_MODELS,
    );

    assert.equal(next.systemPrompt.length, 12000);
  });
});
