import React, { useMemo, useState } from "react";
import { useInput, Box, Text } from "../ink.js";
import type { AppState } from "../state/AppState.js";
import type {
  AgentParameterSettings,
  AgentParameterThinkingMode,
} from "../state/AppStateStore.js";
import type { EffortValue } from "../utils/effort.js";
import { getModelOptions } from "../utils/model/modelOptions.js";

type Props = {
  mainLoopModel: string | null;
  effortValue: EffortValue | undefined;
  fastMode: boolean | undefined;
  parameters: AgentParameterSettings | undefined;
  setAppState: (f: (prev: AppState) => AppState) => void;
};

type EditableTextField = "systemPrompt" | "appendSystemPrompt";

type FieldId =
  | "model"
  | "temperature"
  | "maxOutputTokens"
  | "thinkingMode"
  | "thinkingBudget"
  | "effort"
  | "fastMode"
  | "systemPrompt"
  | "appendSystemPrompt";

const FIELD_ORDER: FieldId[] = [
  "model",
  "temperature",
  "maxOutputTokens",
  "thinkingMode",
  "thinkingBudget",
  "effort",
  "fastMode",
  "systemPrompt",
  "appendSystemPrompt",
];

const THINKING_MODES: AgentParameterThinkingMode[] = [
  "adaptive",
  "enabled",
  "disabled",
];

const EFFORT_LEVELS: Array<EffortValue | undefined> = [
  undefined,
  "low",
  "medium",
  "high",
  "max",
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function slider(value: number, min: number, max: number, width = 12): string {
  const normalized = clamp((value - min) / (max - min), 0, 1);
  const filled = Math.round(normalized * width);
  return `[${"=".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function cycle<T>(values: T[], current: T, delta: 1 | -1): T {
  const currentIndex = values.indexOf(current);
  const base = currentIndex === -1 ? 0 : currentIndex;
  return values[(base + delta + values.length) % values.length]!;
}

function shorten(value: string | undefined, width = 24): string {
  if (!value) return "<empty>";
  if (value.length <= width) return value;
  return `${value.slice(0, width - 3)}...`;
}

export function AgentParametersBar({
  mainLoopModel,
  effortValue,
  fastMode,
  parameters,
  setAppState,
}: Props): React.ReactNode {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingField, setEditingField] = useState<EditableTextField | null>(
    null,
  );
  const [editBuffer, setEditBuffer] = useState("");

  const modelValues = useMemo(
    () => getModelOptions(!!fastMode).map((option) => option.value),
    [fastMode],
  );

  const currentField = FIELD_ORDER[selectedIndex]!;
  const selectedThinkingMode = parameters?.thinkingMode ?? "adaptive";
  const selectedTemperature = parameters?.temperatureOverride ?? 1;
  const selectedMaxOutputTokens = parameters?.maxOutputTokensOverride ?? 4096;
  const selectedThinkingBudget = parameters?.thinkingBudgetTokens ?? 4096;

  const updateParameters = (partial: Partial<AgentParameterSettings>) => {
    setAppState((prev) => ({
      ...prev,
      agentParameters: {
        ...(prev.agentParameters ?? {}),
        ...partial,
      },
    }));
  };

  const updateThinkingMode = (nextMode: AgentParameterThinkingMode) => {
    setAppState((prev) => ({
      ...prev,
      thinkingEnabled: nextMode !== "disabled",
      agentParameters: {
        ...(prev.agentParameters ?? {}),
        thinkingMode: nextMode,
      },
    }));
  };

  const adjustSelectedField = (delta: 1 | -1) => {
    switch (currentField) {
      case "model": {
        if (modelValues.length === 0) return;
        const currentModel = mainLoopModel ?? modelValues[0]!;
        const nextModel = cycle(modelValues, currentModel, delta);
        setAppState((prev) => ({
          ...prev,
          mainLoopModel: nextModel,
          mainLoopModelForSession: null,
        }));
        return;
      }
      case "temperature": {
        const next =
          Math.round(clamp(selectedTemperature + delta * 0.1, 0, 2) * 10) / 10;
        updateParameters({ temperatureOverride: next });
        return;
      }
      case "maxOutputTokens": {
        const next = clamp(selectedMaxOutputTokens + delta * 256, 256, 32768);
        updateParameters({ maxOutputTokensOverride: next });
        return;
      }
      case "thinkingMode": {
        updateThinkingMode(cycle(THINKING_MODES, selectedThinkingMode, delta));
        return;
      }
      case "thinkingBudget": {
        const next = clamp(selectedThinkingBudget + delta * 512, 1024, 32000);
        updateParameters({ thinkingBudgetTokens: next });
        return;
      }
      case "effort": {
        const next = cycle(EFFORT_LEVELS, effortValue, delta);
        setAppState((prev) => ({
          ...prev,
          effortValue: next,
        }));
        return;
      }
      case "fastMode": {
        setAppState((prev) => ({
          ...prev,
          fastMode: !(prev.fastMode ?? false),
        }));
        return;
      }
      case "systemPrompt":
      case "appendSystemPrompt": {
        const nextField: EditableTextField =
          currentField === "systemPrompt"
            ? "systemPrompt"
            : "appendSystemPrompt";
        setEditingField(nextField);
        setEditBuffer(parameters?.[nextField] ?? "");
        return;
      }
    }
  };

  useInput((input, key, event) => {
    if (editingField) {
      if (key.escape) {
        setEditingField(null);
        setEditBuffer("");
        event.stopPropagation();
        return;
      }
      if (key.return) {
        updateParameters({ [editingField]: editBuffer });
        setEditingField(null);
        setEditBuffer("");
        event.stopPropagation();
        return;
      }
      if (key.backspace || key.delete) {
        setEditBuffer((prev) => prev.slice(0, -1));
        event.stopPropagation();
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setEditBuffer((prev) => `${prev}${input}`);
        event.stopPropagation();
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(
        (prev) => (prev - 1 + FIELD_ORDER.length) % FIELD_ORDER.length,
      );
      event.stopPropagation();
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => (prev + 1) % FIELD_ORDER.length);
      event.stopPropagation();
      return;
    }

    if (key.leftArrow) {
      adjustSelectedField(-1);
      event.stopPropagation();
      return;
    }

    if (key.rightArrow || key.return) {
      adjustSelectedField(1);
      event.stopPropagation();
    }
  });

  return (
    <Box
      width={42}
      flexShrink={0}
      marginRight={1}
      paddingX={1}
      paddingY={1}
      borderStyle="round"
      borderColor="gray"
      flexDirection="column"
    >
      <Text bold>Agent Parameters</Text>
      <Text dimColor>up/down select, left/right adjust</Text>
      <Text dimColor>top-p/top-k hidden (unsupported on Anthropic)</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={currentField === "model" ? "claudeBlue" : undefined}>
          {currentField === "model" ? "> " : "  "}
          Model: {mainLoopModel ?? "<default>"}
        </Text>
        <Text color={currentField === "temperature" ? "claudeBlue" : undefined}>
          {currentField === "temperature" ? "> " : "  "}
          Temperature: {slider(selectedTemperature, 0, 2)}{" "}
          {selectedTemperature.toFixed(1)}
        </Text>
        <Text
          color={currentField === "maxOutputTokens" ? "claudeBlue" : undefined}
        >
          {currentField === "maxOutputTokens" ? "> " : "  "}
          Max tokens: {slider(selectedMaxOutputTokens, 256, 32768)}{" "}
          {selectedMaxOutputTokens}
        </Text>
        <Text
          color={currentField === "thinkingMode" ? "claudeBlue" : undefined}
        >
          {currentField === "thinkingMode" ? "> " : "  "}
          Thinking mode: {selectedThinkingMode}
        </Text>
        <Text
          color={currentField === "thinkingBudget" ? "claudeBlue" : undefined}
        >
          {currentField === "thinkingBudget" ? "> " : "  "}
          Thinking budget: {slider(selectedThinkingBudget, 1024, 32000)}{" "}
          {selectedThinkingBudget}
        </Text>
        <Text color={currentField === "effort" ? "claudeBlue" : undefined}>
          {currentField === "effort" ? "> " : "  "}
          Effort: {effortValue ?? "auto"}
        </Text>
        <Text color={currentField === "fastMode" ? "claudeBlue" : undefined}>
          {currentField === "fastMode" ? "> " : "  "}
          Fast mode: {fastMode ? "on" : "off"}
        </Text>
        <Text
          color={currentField === "systemPrompt" ? "claudeBlue" : undefined}
        >
          {currentField === "systemPrompt" ? "> " : "  "}
          System prompt: {shorten(parameters?.systemPrompt)}
        </Text>
        <Text
          color={
            currentField === "appendSystemPrompt" ? "claudeBlue" : undefined
          }
        >
          {currentField === "appendSystemPrompt" ? "> " : "  "}
          Append prompt: {shorten(parameters?.appendSystemPrompt)}
        </Text>
      </Box>

      {editingField && (
        <Box marginTop={1} flexDirection="column">
          <Text color="claudeBlue">Editing {editingField}</Text>
          <Text>{editBuffer || "<empty>"}</Text>
          <Text dimColor>enter save, esc cancel, backspace delete</Text>
        </Box>
      )}
    </Box>
  );
}
