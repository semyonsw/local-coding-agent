const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeApiError(status, payload) {
  const apiMessage = payload?.error?.message;
  const fallback = `Gemini API request failed with status ${status}`;
  const message = apiMessage || fallback;
  const err = new Error(message);
  err.status = status;
  err.payload = payload;
  return err;
}

async function postGenerateContent({
  apiKey,
  model,
  contents,
  systemInstruction,
  functionDeclarations,
  temperature = 0.2,
  topP,
  topK,
  maxOutputTokens = 8192,
  retryCount = 3,
  thinkingMode = "adaptive",
  thinkingBudget,
}) {
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`;

  const body = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens,
    },
  };

  if (typeof topP === "number") {
    body.generationConfig.topP = topP;
  }

  if (typeof topK === "number") {
    body.generationConfig.topK = topK;
  }

  if (thinkingMode !== "disabled") {
    if (typeof thinkingBudget === "number" && thinkingBudget > 0) {
      body.generationConfig.thinkingConfig = {
        thinkingBudget: thinkingBudget,
      };
    } else if (thinkingMode === "enabled") {
      body.generationConfig.thinkingConfig = {
        thinkingBudget: 1024,
      };
    }
  }

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  if (Array.isArray(functionDeclarations) && functionDeclarations.length > 0) {
    body.tools = [
      {
        functionDeclarations,
      },
    ];
  }

  let attempt = 0;
  while (true) {
    attempt += 1;

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (attempt <= retryCount) {
        await sleep(300 * attempt);
        continue;
      }
      throw error;
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const shouldRetry = response.status === 429 || response.status >= 500;
      if (shouldRetry && attempt <= retryCount) {
        await sleep(400 * attempt);
        continue;
      }
      throw normalizeApiError(response.status, payload);
    }

    return payload;
  }
}

function parseModelTurn(payload) {
  const candidate = payload?.candidates?.[0];
  const content = candidate?.content;
  const parts = Array.isArray(content?.parts) ? content.parts : [];

  const textParts = [];
  const thinkingParts = [];
  const functionCalls = [];

  for (const part of parts) {
    if (typeof part?.text === "string") {
      if (part.thought === true) {
        thinkingParts.push(part.text);
      } else {
        textParts.push(part.text);
      }
    }
    if (part?.functionCall?.name) {
      functionCalls.push({
        name: part.functionCall.name,
        args:
          part.functionCall.args && typeof part.functionCall.args === "object"
            ? part.functionCall.args
            : {},
      });
    }
  }

  return {
    role: content?.role || "model",
    parts,
    text: textParts.join("\n").trim(),
    thinking: thinkingParts.join("\n").trim(),
    functionCalls,
    finishReason: candidate?.finishReason || null,
  };
}

module.exports = {
  postGenerateContent,
  parseModelTurn,
};
