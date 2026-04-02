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
    maxTurns = 10,
    maxToolCalls = 20,
    commandTimeoutMs = 15000,
    allowOutsideRoot = true,
    logger = noopLogger(),
  } = config;

  if (!rootDir || !apiKey || !model) {
    throw new Error("createGeminiAgent missing required config fields");
  }

  const systemInstruction = [
    "You are a coding agent running in a local workspace.",
    "Use tools when needed for grounding, then return concise actionable answers.",
    "Prefer reading before writing. Explain file changes clearly.",
    "When a user asks to go/switch/open a folder, call change_dir first and then use relative paths from that directory.",
    "When using run_command, avoid destructive operations.",
  ].join(" ");

  async function sendMessage(session, userMessage) {
    const events = [];
    const startedAt = Date.now();

    if (!session.currentDir) {
      session.currentDir = rootDir;
    }

    logger.info("agent_message_start", {
      sessionId: session.id,
      userMessage,
      totalToolCallsSoFar: session.totalToolCalls,
    });

    session.contents.push({
      role: "user",
      parts: [{ text: userMessage }],
    });

    let finalText = "";

    for (let turn = 0; turn < maxTurns; turn += 1) {
      logger.debug("agent_turn_start", {
        sessionId: session.id,
        turn,
      });

      const payload = await postGenerateContent({
        apiKey,
        model,
        contents: session.contents,
        systemInstruction,
        functionDeclarations: TOOL_DECLARATIONS,
      });

      const parsed = parseModelTurn(payload);
      session.contents.push({
        role: "model",
        parts: parsed.parts,
      });

      if (parsed.functionCalls.length === 0) {
        finalText = parsed.text || "I could not produce a textual response.";
        logger.info("agent_message_end", {
          sessionId: session.id,
          finishReason: parsed.finishReason,
          turnsUsed: turn + 1,
          durationMs: Date.now() - startedAt,
        });
        return {
          sessionId: session.id,
          reply: finalText,
          events,
          finishReason: parsed.finishReason,
        };
      }

      for (const call of parsed.functionCalls) {
        if (session.totalToolCalls >= maxToolCalls) {
          logger.warn("agent_tool_budget_reached", {
            sessionId: session.id,
            totalToolCalls: session.totalToolCalls,
            maxToolCalls,
            durationMs: Date.now() - startedAt,
          });
          return {
            sessionId: session.id,
            reply:
              "Stopped because tool-call budget was reached. Ask me to continue if you want another pass.",
            events,
            finishReason: "tool_call_budget",
          };
        }

        events.push({
          type: "tool_start",
          name: call.name,
          args: truncateForEvent(call.args),
        });

        logger.info("agent_tool_start", {
          sessionId: session.id,
          tool: call.name,
          args: call.args,
        });

        const toolResult = await executeToolCall(
          rootDir,
          { name: call.name, args: call.args },
          {
            commandTimeoutMs,
            allowOutsideRoot,
            currentDir: session.currentDir,
            logger,
          },
        );

        session.totalToolCalls += 1;

        events.push({
          type: "tool_end",
          name: call.name,
          ok: toolResult.ok,
          output: truncateForEvent(toolResult),
        });

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

    logger.warn("agent_message_end", {
      sessionId: session.id,
      finishReason: "max_turns",
      durationMs: Date.now() - startedAt,
    });

    return {
      sessionId: session.id,
      reply:
        "Stopped because max model turns were reached. Ask me to continue if needed.",
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
