const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { parseModelTurn } = require("../gemini-api");

describe("parseModelTurn", () => {
  it("extracts text from a simple response", () => {
    const payload = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "Hello, world!" }],
          },
          finishReason: "STOP",
        },
      ],
    };

    const result = parseModelTurn(payload);
    assert.equal(result.text, "Hello, world!");
    assert.equal(result.role, "model");
    assert.equal(result.finishReason, "STOP");
    assert.equal(result.functionCalls.length, 0);
  });

  it("extracts function calls", () => {
    const payload = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "read_file",
                  args: { path: "test.txt" },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    };

    const result = parseModelTurn(payload);
    assert.equal(result.functionCalls.length, 1);
    assert.equal(result.functionCalls[0].name, "read_file");
    assert.deepEqual(result.functionCalls[0].args, { path: "test.txt" });
    assert.equal(result.text, "");
  });

  it("handles mixed text and function calls", () => {
    const payload = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { text: "Let me read that file." },
              {
                functionCall: {
                  name: "read_file",
                  args: { path: "foo.js" },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    };

    const result = parseModelTurn(payload);
    assert.equal(result.text, "Let me read that file.");
    assert.equal(result.functionCalls.length, 1);
  });

  it("handles empty/malformed payload gracefully", () => {
    assert.doesNotThrow(() => parseModelTurn({}));
    assert.doesNotThrow(() => parseModelTurn(null));
    assert.doesNotThrow(() => parseModelTurn({ candidates: [] }));
    assert.doesNotThrow(() => parseModelTurn({ candidates: [{}] }));

    const result = parseModelTurn({});
    assert.equal(result.text, "");
    assert.equal(result.functionCalls.length, 0);
    assert.equal(result.finishReason, null);
  });

  it("handles function call with no args", () => {
    const payload = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "list_dir",
                  args: null,
                },
              },
            ],
          },
        },
      ],
    };

    const result = parseModelTurn(payload);
    assert.equal(result.functionCalls.length, 1);
    assert.deepEqual(result.functionCalls[0].args, {});
  });

  it("joins multiple text parts with newline", () => {
    const payload = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "Line 1" }, { text: "Line 2" }],
          },
        },
      ],
    };

    const result = parseModelTurn(payload);
    assert.equal(result.text, "Line 1\nLine 2");
  });
});
