const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

function buildCacheEntry(filename, exportsObject) {
  return {
    id: filename,
    filename,
    loaded: true,
    exports: exportsObject,
  };
}

async function withMockedAgentDependencies(mocks, run) {
  const apiPath = require.resolve("../gemini-api");
  const toolsPath = require.resolve("../gemini-tools");
  const agentPath = require.resolve("../gemini-agent");

  const originalApi = require.cache[apiPath];
  const originalTools = require.cache[toolsPath];
  const originalAgent = require.cache[agentPath];

  delete require.cache[agentPath];
  require.cache[apiPath] = buildCacheEntry(apiPath, mocks.api);
  require.cache[toolsPath] = buildCacheEntry(toolsPath, mocks.tools);

  try {
    const { createGeminiAgent } = require("../gemini-agent");
    await run(createGeminiAgent);
  } finally {
    if (originalApi) {
      require.cache[apiPath] = originalApi;
    } else {
      delete require.cache[apiPath];
    }

    if (originalTools) {
      require.cache[toolsPath] = originalTools;
    } else {
      delete require.cache[toolsPath];
    }

    if (originalAgent) {
      require.cache[agentPath] = originalAgent;
    } else {
      delete require.cache[agentPath];
    }
  }
}

describe("createGeminiAgent runtime overrides", () => {
  it("passes inference overrides to Gemini generation payload", async () => {
    const capturedPayloads = [];

    await withMockedAgentDependencies(
      {
        api: {
          postGenerateContent: async (payload) => {
            capturedPayloads.push(payload);
            return { turn: 1 };
          },
          parseModelTurn: () => ({
            role: "model",
            parts: [{ text: "Done" }],
            text: "Done",
            thinking: "",
            functionCalls: [],
            finishReason: "STOP",
          }),
        },
        tools: {
          TOOL_DECLARATIONS: [{ name: "read_file" }],
          executeToolCall: async () => ({ ok: true, data: {} }),
        },
      },
      async (createGeminiAgent) => {
        const agent = createGeminiAgent({
          rootDir: "/tmp/workspace",
          apiKey: "test-key",
          model: "gemini-3-flash-preview",
          temperature: 0.2,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 8192,
          thinkingMode: "adaptive",
          thinkingBudget: 0,
          systemPrompt: "Base prompt",
        });

        const session = {
          id: "session-1",
          contents: [],
          totalToolCalls: 0,
          currentDir: "/tmp/workspace",
        };

        const result = await agent.sendMessage(session, "hello", undefined, {
          model: "gemini-3-pro-preview",
          temperature: 1.1,
          topP: 0.41,
          topK: 17,
          maxOutputTokens: 4096,
          thinkingMode: "enabled",
          thinkingBudget: 2048,
          systemPrompt: "Be concise and check assumptions.",
        });

        assert.equal(result.reply, "Done");
      },
    );

    assert.equal(capturedPayloads.length, 1);

    const payload = capturedPayloads[0];
    assert.equal(payload.model, "gemini-3-pro-preview");
    assert.equal(payload.temperature, 1.1);
    assert.equal(payload.topP, 0.41);
    assert.equal(payload.topK, 17);
    assert.equal(payload.maxOutputTokens, 4096);
    assert.equal(payload.thinkingMode, "enabled");
    assert.equal(payload.thinkingBudget, 2048);
    assert.match(
      payload.systemInstruction,
      /Be concise and check assumptions\./,
    );
  });

  it("passes loop and runtime controls into tool execution", async () => {
    const toolExecutions = [];
    let callCount = 0;

    await withMockedAgentDependencies(
      {
        api: {
          postGenerateContent: async () => {
            callCount += 1;
            return { turn: callCount };
          },
          parseModelTurn: (payload) => {
            if (payload.turn === 1) {
              return {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      name: "change_dir",
                      args: { path: "src" },
                    },
                  },
                ],
                text: "",
                thinking: "",
                functionCalls: [
                  {
                    name: "change_dir",
                    args: { path: "src" },
                  },
                ],
                finishReason: null,
              };
            }

            return {
              role: "model",
              parts: [{ text: "Completed" }],
              text: "Completed",
              thinking: "",
              functionCalls: [],
              finishReason: "STOP",
            };
          },
        },
        tools: {
          TOOL_DECLARATIONS: [{ name: "change_dir" }],
          executeToolCall: async (rootDir, call, options) => {
            toolExecutions.push({ rootDir, call, options });
            return {
              ok: true,
              data: { cwd: "/tmp/workspace/src" },
            };
          },
        },
      },
      async (createGeminiAgent) => {
        const agent = createGeminiAgent({
          rootDir: "/tmp/workspace",
          apiKey: "test-key",
          model: "gemini-3-flash-preview",
          maxTurns: 10,
          maxToolCalls: 20,
          commandTimeoutMs: 15000,
          allowOutsideRoot: false,
        });

        const session = {
          id: "session-2",
          contents: [],
          totalToolCalls: 0,
          currentDir: "/tmp/workspace",
        };

        const result = await agent.sendMessage(
          session,
          "go to src",
          undefined,
          {
            maxTurns: 3,
            maxToolCalls: 1,
            commandTimeoutMs: 5400,
            allowOutsideRoot: true,
          },
        );

        assert.equal(result.reply, "Completed");
        assert.equal(session.currentDir, "/tmp/workspace/src");
      },
    );

    assert.equal(toolExecutions.length, 1);
    assert.equal(toolExecutions[0].options.commandTimeoutMs, 5400);
    assert.equal(toolExecutions[0].options.allowOutsideRoot, true);
    assert.equal(toolExecutions[0].options.currentDir, "/tmp/workspace");
  });

  it("respects maxTurns override and stops the loop", async () => {
    await withMockedAgentDependencies(
      {
        api: {
          postGenerateContent: async () => ({ mocked: true }),
          parseModelTurn: () => ({
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "list_dir",
                  args: { path: "." },
                },
              },
            ],
            text: "",
            thinking: "",
            functionCalls: [
              {
                name: "list_dir",
                args: { path: "." },
              },
            ],
            finishReason: null,
          }),
        },
        tools: {
          TOOL_DECLARATIONS: [{ name: "list_dir" }],
          executeToolCall: async () => ({ ok: true, data: { items: [] } }),
        },
      },
      async (createGeminiAgent) => {
        const agent = createGeminiAgent({
          rootDir: "/tmp/workspace",
          apiKey: "test-key",
          model: "gemini-3-flash-preview",
          maxTurns: 10,
          maxToolCalls: 10,
        });

        const session = {
          id: "session-3",
          contents: [],
          totalToolCalls: 0,
          currentDir: "/tmp/workspace",
        };

        const result = await agent.sendMessage(
          session,
          "list files",
          undefined,
          {
            maxTurns: 1,
          },
        );

        assert.equal(result.finishReason, "max_turns");
        assert.match(result.reply, /max model turns/i);
      },
    );
  });
});
