const { postGenerateContent, parseModelTurn } = require("./gemini-api");
const { TOOL_DECLARATIONS, executeToolCall } = require("./gemini-tools");
const { noopLogger } = require("./gemini-logger");

function truncateForEvent(value, max = 1600) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2) || "";
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n... [truncated ${text.length - max} chars]`;
}

function createGeminiAgent(config) {
  const {
    rootDir,
    apiKey,
    model,
    temperature = 0.2,
    topP = 0.95,
    topK = 40,
    maxTurns = 10,
    maxToolCalls = 20,
    commandTimeoutMs = 15000,
    maxOutputTokens = 8192,
    thinkingMode = "adaptive",
    thinkingBudget = 0,
    systemPrompt = "",
    allowOutsideRoot = false,
    logger = noopLogger(),
  } = config;

  if (!rootDir || !apiKey || !model) {
    throw new Error("createGeminiAgent missing required config fields");
  }

  const baseSystemInstruction = [
    "You are a coding agent running in a local workspace.",
    "Use tools when needed for grounding, then return concise actionable answers.",
    "Prefer reading before writing. Explain file changes clearly.",
    "When a user asks to go/switch/open a folder, call change_dir first and then use relative paths from that directory.",
    "When using run_command, avoid destructive operations.",
  ].join(" ");

  function buildSystemInstruction(customSystemPrompt) {
    const prompt = String(customSystemPrompt || "").trim();
    if (!prompt) {
      return baseSystemInstruction;
    }
    return `${baseSystemInstruction}\n\nCustom system prompt:\n${prompt}`;
  }

  async function sendMessage(
    session,
    userMessage,
    onEvent,
    runtimeOverrides = {},
  ) {
    const events = [];
    const emit = typeof onEvent === "function" ? onEvent : () => {};
    const startedAt = Date.now();
    const effectiveModel =
      typeof runtimeOverrides.model === "string" &&
      runtimeOverrides.model.trim()
        ? runtimeOverrides.model.trim()
        : model;
    const effectiveTemperature =
      typeof runtimeOverrides.temperature === "number"
        ? runtimeOverrides.temperature
        : temperature;
    const effectiveTopP =
      typeof runtimeOverrides.topP === "number" ? runtimeOverrides.topP : topP;
    const effectiveTopK =
      typeof runtimeOverrides.topK === "number" ? runtimeOverrides.topK : topK;
    const effectiveMaxTurns =
      Number.isInteger(runtimeOverrides.maxTurns) &&
      runtimeOverrides.maxTurns > 0
        ? runtimeOverrides.maxTurns
        : maxTurns;
    const effectiveMaxToolCalls =
      Number.isInteger(runtimeOverrides.maxToolCalls) &&
      runtimeOverrides.maxToolCalls > 0
        ? runtimeOverrides.maxToolCalls
        : maxToolCalls;
    const effectiveCommandTimeoutMs =
      Number.isInteger(runtimeOverrides.commandTimeoutMs) &&
      runtimeOverrides.commandTimeoutMs > 0
        ? runtimeOverrides.commandTimeoutMs
        : commandTimeoutMs;
    const effectiveMaxOutputTokens =
      Number.isInteger(runtimeOverrides.maxOutputTokens) &&
      runtimeOverrides.maxOutputTokens > 0
        ? runtimeOverrides.maxOutputTokens
        : maxOutputTokens;
    const effectiveThinkingBudget =
      typeof runtimeOverrides.thinkingBudget === "number"
        ? runtimeOverrides.thinkingBudget
        : thinkingBudget;
    const effectiveThinkingMode =
      typeof runtimeOverrides.thinkingMode === "string"
        ? runtimeOverrides.thinkingMode
        : thinkingMode;
    const effectiveAllowOutsideRoot =
      typeof runtimeOverrides.allowOutsideRoot === "boolean"
        ? runtimeOverrides.allowOutsideRoot
        : allowOutsideRoot;
    const effectiveSystemPrompt =
      typeof runtimeOverrides.systemPrompt === "string"
        ? runtimeOverrides.systemPrompt
        : systemPrompt;

    if (!session.currentDir) {
      session.currentDir = rootDir;
    }

    logger.info("agent_message_start", {
      sessionId: session.id,
      userMessage,
      totalToolCallsSoFar: session.totalToolCalls,
      model: effectiveModel,
    });

    session.contents.push({
      role: "user",
      parts: [{ text: userMessage }],
    });

    let finalText = "";

    for (let turn = 0; turn < effectiveMaxTurns; turn += 1) {
      logger.debug("agent_turn_start", {
        sessionId: session.id,
        turn,
      });

      const payload = await postGenerateContent({
        apiKey,
        model: effectiveModel,
        contents: session.contents,
        systemInstruction: buildSystemInstruction(effectiveSystemPrompt),
        functionDeclarations: TOOL_DECLARATIONS,
        temperature: effectiveTemperature,
        topP: effectiveTopP,
        topK: effectiveTopK,
        maxOutputTokens: effectiveMaxOutputTokens,
        thinkingMode: effectiveThinkingMode,
        thinkingBudget: effectiveThinkingBudget,
      });

      const parsed = parseModelTurn(payload);

      if (parsed.thinking) {
        emit({ type: "thinking", text: parsed.thinking });
      }

      session.contents.push({
        role: "model",
        parts: parsed.parts,
      });

      if (parsed.functionCalls.length === 0) {
        finalText = parsed.text || "I could not produce a textual response.";
        emit({ type: "text", text: finalText });
        logger.info("agent_message_end", {
          sessionId: session.id,
          finishReason: parsed.finishReason,
          turnsUsed: turn + 1,
          durationMs: Date.now() - startedAt,
        });
        const result = {
          sessionId: session.id,
          reply: finalText,
          events,
          finishReason: parsed.finishReason,
        };
        emit({
          type: "done",
          finishReason: parsed.finishReason,
          sessionId: session.id,
        });
        return result;
      }

      for (const call of parsed.functionCalls) {
        if (session.totalToolCalls >= effectiveMaxToolCalls) {
          const budgetMsg =
            "Stopped because tool-call budget was reached. Ask me to continue if you want another pass.";
          emit({ type: "text", text: budgetMsg });
          logger.warn("agent_tool_budget_reached", {
            sessionId: session.id,
            totalToolCalls: session.totalToolCalls,
            maxToolCalls: effectiveMaxToolCalls,
            durationMs: Date.now() - startedAt,
          });
          emit({
            type: "done",
            finishReason: "tool_call_budget",
            sessionId: session.id,
          });
          return {
            sessionId: session.id,
            reply: budgetMsg,
            events,
            finishReason: "tool_call_budget",
          };
        }

        const toolStartEvent = {
          type: "tool_start",
          name: call.name,
          args: truncateForEvent(call.args),
        };
        events.push(toolStartEvent);
        emit(toolStartEvent);

        logger.info("agent_tool_start", {
          sessionId: session.id,
          tool: call.name,
          args: call.args,
        });

        const toolResult = await executeToolCall(
          rootDir,
          { name: call.name, args: call.args },
          {
            commandTimeoutMs: effectiveCommandTimeoutMs,
            allowOutsideRoot: effectiveAllowOutsideRoot,
            currentDir: session.currentDir,
            logger,
          },
        );

        session.totalToolCalls += 1;

        const toolEndEvent = {
          type: "tool_end",
          name: call.name,
          ok: toolResult.ok,
          output: truncateForEvent(toolResult),
        };
        events.push(toolEndEvent);
        emit(toolEndEvent);

        logger.info("agent_tool_end", {
          sessionId: session.id,
          tool: call.name,
          ok: toolResult.ok,
        });

        if (
          call.name === "change_dir" &&
          toolResult.ok &&
          toolResult.data &&
          typeof toolResult.data.cwd === "string"
        ) {
          session.currentDir = toolResult.data.cwd;
          logger.info("agent_current_dir_updated", {
            sessionId: session.id,
            currentDir: session.currentDir,
          });
        }

        session.contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: call.name,
                response: toolResult,
              },
            },
          ],
        });
      }
    }

    const maxTurnsMsg =
      "Stopped because max model turns were reached. Ask me to continue if needed.";
    emit({ type: "text", text: maxTurnsMsg });
    logger.warn("agent_message_end", {
      sessionId: session.id,
      finishReason: "max_turns",
      durationMs: Date.now() - startedAt,
    });
    emit({ type: "done", finishReason: "max_turns", sessionId: session.id });

    return {
      sessionId: session.id,
      reply: maxTurnsMsg,
      events,
      finishReason: "max_turns",
    };
  }

  return {
    model,
    sendMessage,
  };
}

module.exports = {
  createGeminiAgent,
};
