const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

const {
  getGeminiRuntimeConfig,
  loadDotEnvIfPresent,
} = require("../gemini-env");

const TEST_ROOT = path.join(os.tmpdir(), "gemini-env-test-" + Date.now());

function setup() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
}

function teardown() {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
}

setup();
process.on("exit", teardown);

describe("loadDotEnvIfPresent", () => {
  it("returns loaded=false when no .env exists", () => {
    const emptyDir = path.join(TEST_ROOT, "empty");
    fs.mkdirSync(emptyDir, { recursive: true });
    const result = loadDotEnvIfPresent(emptyDir);
    assert.equal(result.loaded, false);
  });

  it("parses .env file with quoted and unquoted values", () => {
    const dir = path.join(TEST_ROOT, "withenv");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".env"),
      "TEST_KEY_1=\"value1\"\nTEST_KEY_2=value2\n# comment\nTEST_KEY_3='value3'\n",
    );

    // Clear before test
    delete process.env.TEST_KEY_1;
    delete process.env.TEST_KEY_2;
    delete process.env.TEST_KEY_3;

    const result = loadDotEnvIfPresent(dir);
    assert.equal(result.loaded, true);
    assert.equal(process.env.TEST_KEY_1, "value1");
    assert.equal(process.env.TEST_KEY_2, "value2");
    assert.equal(process.env.TEST_KEY_3, "value3");

    // Cleanup
    delete process.env.TEST_KEY_1;
    delete process.env.TEST_KEY_2;
    delete process.env.TEST_KEY_3;
  });

  it("does not override existing env vars", () => {
    const dir = path.join(TEST_ROOT, "nooverride");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".env"), "TEST_EXISTING=new_value\n");

    process.env.TEST_EXISTING = "original";
    loadDotEnvIfPresent(dir);
    assert.equal(process.env.TEST_EXISTING, "original");

    delete process.env.TEST_EXISTING;
  });
});

describe("getGeminiRuntimeConfig", () => {
  const savedEnv = {};

  beforeEach(() => {
    // Save and set required env vars
    savedEnv.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-key-123";
  });

  afterEach(() => {
    // Restore env
    if (savedEnv.GEMINI_API_KEY === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = savedEnv.GEMINI_API_KEY;
    }
    delete process.env.GEMINI_MAX_TURNS;
    delete process.env.GEMINI_MAX_TOOL_CALLS;
    delete process.env.GEMINI_MAX_OUTPUT_TOKENS;
    delete process.env.GEMINI_TEMPERATURE;
    delete process.env.GEMINI_TOP_P;
    delete process.env.GEMINI_TOP_K;
    delete process.env.GEMINI_THINKING_MODE;
    delete process.env.GEMINI_SYSTEM_PROMPT;
  });

  it("returns default config values", () => {
    const config = getGeminiRuntimeConfig({ rootDir: TEST_ROOT });
    assert.equal(config.apiKey, "test-key-123");
    assert.equal(config.model, "gemini-3-flash-preview");
    assert.equal(config.port, 7789);
    assert.equal(config.maxTurns, 10);
    assert.equal(config.maxToolCalls, 20);
    assert.equal(config.allowOutsideRoot, false);
    assert.equal(config.maxOutputTokens, 8192);
    assert.equal(config.temperature, 0.2);
    assert.equal(config.topP, 0.95);
    assert.equal(config.topK, 40);
    assert.equal(config.thinkingMode, "adaptive");
    assert.equal(config.systemPrompt, "");
  });

  it("respects model override", () => {
    const config = getGeminiRuntimeConfig({
      rootDir: TEST_ROOT,
      modelOverride: "gemini-3-pro-preview",
    });
    assert.equal(config.model, "gemini-3-pro-preview");
  });

  it("rejects max turns above ceiling", () => {
    process.env.GEMINI_MAX_TURNS = "999";
    assert.throws(
      () => getGeminiRuntimeConfig({ rootDir: TEST_ROOT }),
      /must be <= 200/,
    );
  });

  it("rejects max tool calls above ceiling", () => {
    process.env.GEMINI_MAX_TOOL_CALLS = "500";
    assert.throws(
      () => getGeminiRuntimeConfig({ rootDir: TEST_ROOT }),
      /must be <= 200/,
    );
  });

  it("rejects max output tokens above ceiling", () => {
    process.env.GEMINI_MAX_OUTPUT_TOKENS = "99999";
    assert.throws(
      () => getGeminiRuntimeConfig({ rootDir: TEST_ROOT }),
      /must be <= 65536/,
    );
  });

  it("rejects temperature outside allowed range", () => {
    process.env.GEMINI_TEMPERATURE = "2.5";
    assert.throws(
      () => getGeminiRuntimeConfig({ rootDir: TEST_ROOT }),
      /GEMINI_TEMPERATURE/,
    );
  });

  it("rejects top_p outside allowed range", () => {
    process.env.GEMINI_TOP_P = "-0.2";
    assert.throws(
      () => getGeminiRuntimeConfig({ rootDir: TEST_ROOT }),
      /GEMINI_TOP_P/,
    );
  });

  it("rejects unsupported thinking mode", () => {
    process.env.GEMINI_THINKING_MODE = "always";
    assert.throws(
      () => getGeminiRuntimeConfig({ rootDir: TEST_ROOT }),
      /GEMINI_THINKING_MODE/,
    );
  });

  it("throws when rootDir is missing", () => {
    assert.throws(() => getGeminiRuntimeConfig({}), /requires rootDir/);
  });
});
