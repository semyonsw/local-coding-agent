const fs = require("fs");
const os = require("os");
const path = require("path");
const { exec } = require("child_process");
const { noopLogger } = require("./gemini-logger");

const MAX_FILE_READ_BYTES = 200_000;
const MAX_WRITE_BYTES = 200_000;
const MAX_COMMAND_OUTPUT = 24_000;

const COMMON_DIR_ALIASES = {
  desktop: "Desktop",
  documents: "Documents",
  downloads: "Downloads",
  pictures: "Pictures",
  music: "Music",
  videos: "Videos",
};

function truncate(text, max) {
  if (typeof text !== "string") return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n... [truncated ${text.length - max} chars]`;
}

function assertInsideRoot(rootResolved, absPath, requestedPath) {
  if (absPath === rootResolved) return;

  const rootWithSep = rootResolved.endsWith(path.sep)
    ? rootResolved
    : `${rootResolved}${path.sep}`;

  if (!absPath.startsWith(rootWithSep)) {
    throw new Error(`Path is outside workspace root: ${requestedPath}`);
  }
}

function inferWindowsStyleHomeFromRoot(rootDir) {
  const normalized = path.resolve(rootDir).replace(/\\/g, "/");
  const match = normalized.match(/^\/[a-zA-Z]\/Users\/[^/]+/);
  return match ? match[0] : null;
}

function buildHomeCandidates(rootDir) {
  const candidates = [];
  const seen = new Set();

  function pushCandidate(value) {
    if (!value || typeof value !== "string") return;
    const resolved = path.resolve(value);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    candidates.push(resolved);
  }

  pushCandidate(process.env.USERPROFILE);
  pushCandidate(process.env.HOME);
  pushCandidate(os.homedir());
  pushCandidate(inferWindowsStyleHomeFromRoot(rootDir));

  return candidates;
}

function parseFirstSegment(input) {
  const normalized = String(input || "").replace(/\\/g, "/");
  const parts = normalized.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) {
    return { firstSegment: "", remainderParts: [] };
  }
  return {
    firstSegment: parts[0],
    remainderParts: parts.slice(1),
  };
}

function expandCommonDirAlias(rootDir, baseDir, inputPath) {
  if (!inputPath || path.isAbsolute(inputPath)) {
    return inputPath;
  }

  const { firstSegment, remainderParts } = parseFirstSegment(inputPath);
  const alias = COMMON_DIR_ALIASES[firstSegment.toLowerCase()];
  if (!alias) {
    return inputPath;
  }

  const localCandidate = path.resolve(baseDir, inputPath);
  if (fs.existsSync(localCandidate)) {
    return inputPath;
  }

  const homes = buildHomeCandidates(rootDir);
  if (homes.length === 0) {
    return inputPath;
  }

  for (const home of homes) {
    const mapped = path.join(home, alias, ...remainderParts);
    if (fs.existsSync(mapped)) {
      return mapped;
    }
  }

  return path.join(homes[0], alias, ...remainderParts);
}

function resolveToolPath(rootDir, requestedPath, options = {}) {
  const rootResolved = path.resolve(rootDir);
  const allowOutsideRoot = Boolean(options.allowOutsideRoot);

  const inputRaw =
    typeof requestedPath === "string" ? requestedPath.trim() : ".";
  const input = inputRaw || ".";

  let baseDir = rootResolved;
  if (typeof options.currentDir === "string" && options.currentDir.trim()) {
    const baseInput = options.currentDir.trim();
    baseDir = path.isAbsolute(baseInput)
      ? path.resolve(baseInput)
      : path.resolve(rootResolved, baseInput);

    if (!allowOutsideRoot) {
      assertInsideRoot(rootResolved, baseDir, options.currentDir);
    }
  }

  const aliasExpanded = expandCommonDirAlias(rootDir, baseDir, input);
  const absPath = path.isAbsolute(aliasExpanded)
    ? path.resolve(aliasExpanded)
    : path.resolve(baseDir, aliasExpanded);

  if (!allowOutsideRoot) {
    assertInsideRoot(rootResolved, absPath, requestedPath);
  }

  return absPath;
}

function asDisplayPath(rootDir, absPath) {
  const rel = path.relative(rootDir, absPath);
  if (!rel) return ".";

  const outside =
    rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);

  return outside ? absPath : rel;
}

async function listDirTool(rootDir, args, options = {}) {
  const target = resolveToolPath(rootDir, args.path || ".", options);
  const entries = await fs.promises.readdir(target, { withFileTypes: true });

  const items = entries.slice(0, 300).map((d) => {
    const full = path.join(target, d.name);
    return {
      name: d.name,
      path: asDisplayPath(rootDir, full),
      type: d.isDirectory() ? "directory" : "file",
    };
  });

  return {
    ok: true,
    data: {
      directory: asDisplayPath(rootDir, target),
      count: items.length,
      items,
    },
  };
}

async function readFileTool(rootDir, args, options = {}) {
  if (!args.path || typeof args.path !== "string") {
    throw new Error("read_file requires a string path");
  }

  const target = resolveToolPath(rootDir, args.path, options);
  const stat = await fs.promises.stat(target);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${args.path}`);
  }

  const buf = await fs.promises.readFile(target);
  const used = buf.subarray(0, MAX_FILE_READ_BYTES);
  const text = used.toString("utf8");

  const startLine = Number.isFinite(args.startLine)
    ? Number(args.startLine)
    : 1;
  const endLine = Number.isFinite(args.endLine)
    ? Number(args.endLine)
    : startLine + 300;

  const lines = text.split(/\r?\n/);
  const s = Math.max(1, startLine);
  const e = Math.min(lines.length, Math.max(s, endLine));
  const selected = lines.slice(s - 1, e).join("\n");

  return {
    ok: true,
    data: {
      path: asDisplayPath(rootDir, target),
      startLine: s,
      endLine: e,
      content: selected,
      truncated: buf.length > MAX_FILE_READ_BYTES,
    },
  };
}

async function writeFileTool(rootDir, args, options = {}) {
  if (!args.path || typeof args.path !== "string") {
    throw new Error("write_file requires a string path");
  }
  const content = typeof args.content === "string" ? args.content : "";

  if (content.length > MAX_WRITE_BYTES) {
    throw new Error(`write_file content too large (>${MAX_WRITE_BYTES} chars)`);
  }

  const target = resolveToolPath(rootDir, args.path, options);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });

  const append = Boolean(args.append);
  if (append) {
    await fs.promises.appendFile(target, content, "utf8");
  } else {
    await fs.promises.writeFile(target, content, "utf8");
  }

  return {
    ok: true,
    data: {
      path: asDisplayPath(rootDir, target),
      mode: append ? "append" : "overwrite",
      charsWritten: content.length,
    },
  };
}

function validateCommand(command) {
  if (!command || typeof command !== "string") {
    throw new Error("run_command requires a command string");
  }

  const blockedPatterns = [
    // Destructive filesystem operations
    /(^|\s|&&|\|)rm\s+-[a-zA-Z]*r[a-zA-Z]*f/i,
    /(^|\s|&&|\|)rm\s+-[a-zA-Z]*f[a-zA-Z]*r/i,
    /(^|\s|&&|\|)rm\s+-rf\s+[~/.]/i,
    // System control
    /(^|\s|&&|\|)shutdown(\s|$)/i,
    /(^|\s|&&|\|)reboot(\s|$)/i,
    /(^|\s|&&|\|)mkfs(\s|$)/i,
    /(^|\s|&&|\|)dd\s+/i,
    /(^|\s|&&|\|)format(\s|$)/i,
    // Privilege escalation
    /(^|\s|&&|\|)sudo(\s|$)/i,
    /(^|\s|&&|\|)su\s+-/i,
    // Permission bombs
    /(^|\s|&&|\|)chmod\s+(-R\s+)?777/i,
    /(^|\s|&&|\|)chmod\s+(-R\s+)?a\+rwx/i,
    // Remote code execution via pipe
    /curl\s+.*\|\s*(ba)?sh/i,
    /wget\s+.*\|\s*(ba)?sh/i,
    /curl\s+.*\|\s*python/i,
    /wget\s+.*-O\s*-\s*\|\s*(ba)?sh/i,
    // Fork bombs
    /:\(\)\s*\{\s*:\|:&\s*;\s*\}/,
    /perl\s+-e\s*.*fork/i,
    // Dangerous git operations
    /git\s+push\s+.*--force(\s|$)/i,
    /git\s+push\s+-f(\s|$)/i,
    // Network exfiltration tools (outbound)
    /(^|\s|&&|\|)nc\s+-[a-zA-Z]*l/i,
    /(^|\s|&&|\|)ncat(\s|$)/i,
    // PowerShell destructive cmdlets
    /Remove-Item\s+.*-Recurse/i,
    /Format-Volume/i,
    /Stop-Computer/i,
    /Restart-Computer/i,
    /Clear-Disk/i,
  ];

  for (const pattern of blockedPatterns) {
    if (pattern.test(command)) {
      throw new Error("Command blocked by safety policy");
    }
  }
}

function runCommandTool(rootDir, args, options = {}) {
  const command = args.command;
  validateCommand(command);

  const hasExplicitCwd = Boolean(args.cwd && String(args.cwd).trim());
  const cwdInput = hasExplicitCwd ? args.cwd : options.currentDir || ".";

  const cwd = resolveToolPath(
    rootDir,
    cwdInput,
    hasExplicitCwd
      ? {
          ...options,
          currentDir: options.currentDir,
        }
      : {
          ...options,
          currentDir: undefined,
        },
  );
  const timeoutMs = Math.max(
    1000,
    Math.min(
      Number(args.timeoutMs) || options.defaultTimeoutMs || 15000,
      60000,
    ),
  );

  return new Promise((resolve, reject) => {
    exec(
      command,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        shell: process.platform === "win32"
        ? process.env.COMSPEC || "cmd.exe"
        : process.env.SHELL || "/bin/bash",
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            ok: false,
            error: error.message,
            data: {
              cwd: asDisplayPath(rootDir, cwd),
              stdout: truncate(stdout || "", MAX_COMMAND_OUTPUT),
              stderr: truncate(stderr || "", MAX_COMMAND_OUTPUT),
              exitCode: typeof error.code === "number" ? error.code : null,
            },
          });
          return;
        }

        resolve({
          ok: true,
          data: {
            cwd: asDisplayPath(rootDir, cwd),
            stdout: truncate(stdout || "", MAX_COMMAND_OUTPUT),
            stderr: truncate(stderr || "", MAX_COMMAND_OUTPUT),
            exitCode: 0,
          },
        });
      },
    );
  });
}

async function changeDirTool(rootDir, args, options = {}) {
  if (!args.path || typeof args.path !== "string") {
    throw new Error("change_dir requires a string path");
  }

  const target = resolveToolPath(rootDir, args.path, options);
  const stat = await fs.promises.stat(target);

  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${args.path}`);
  }

  return {
    ok: true,
    data: {
      cwd: target,
      displayPath: asDisplayPath(rootDir, target),
    },
  };
}

const TOOL_DECLARATIONS = [
  {
    name: "list_dir",
    description: "List files and folders in a workspace directory",
    parameters: {
      type: "OBJECT",
      properties: {
        path: {
          type: "STRING",
          description:
            "Directory path relative to workspace root, or absolute path when outside-root mode is enabled",
        },
      },
    },
  },
  {
    name: "read_file",
    description: "Read text from a file in the workspace",
    parameters: {
      type: "OBJECT",
      properties: {
        path: {
          type: "STRING",
          description:
            "File path relative to workspace, or absolute path when outside-root mode is enabled",
        },
        startLine: { type: "NUMBER", description: "1-based start line" },
        endLine: { type: "NUMBER", description: "1-based end line" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write or append text to a file in the workspace",
    parameters: {
      type: "OBJECT",
      properties: {
        path: {
          type: "STRING",
          description:
            "File path relative to workspace, or absolute path when outside-root mode is enabled",
        },
        content: { type: "STRING", description: "Text content to write" },
        append: {
          type: "BOOLEAN",
          description: "Append if true, overwrite if false",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "run_command",
    description: "Run a shell command in the workspace and capture output",
    parameters: {
      type: "OBJECT",
      properties: {
        command: { type: "STRING", description: "Shell command to execute" },
        cwd: {
          type: "STRING",
          description:
            "Working directory relative to workspace, or absolute path when outside-root mode is enabled",
        },
        timeoutMs: { type: "NUMBER", description: "Timeout in milliseconds" },
      },
      required: ["command"],
    },
  },
  {
    name: "change_dir",
    description: "Change the current working directory for this chat session",
    parameters: {
      type: "OBJECT",
      properties: {
        path: {
          type: "STRING",
          description:
            "Directory path relative to current session directory, or absolute path when outside-root mode is enabled",
        },
      },
      required: ["path"],
    },
  },
];

async function executeToolCall(rootDir, toolCall, options = {}) {
  const logger = options.logger || noopLogger();
  const startedAt = Date.now();
  const name = toolCall?.name;
  const args =
    toolCall?.args && typeof toolCall.args === "object" ? toolCall.args : {};

  logger.info("tool_start", {
    tool: name,
    args,
    allowOutsideRoot: Boolean(options.allowOutsideRoot),
  });

  try {
    let result;
    switch (name) {
      case "list_dir":
        result = await listDirTool(rootDir, args, options);
        break;
      case "read_file":
        result = await readFileTool(rootDir, args, options);
        break;
      case "write_file":
        result = await writeFileTool(rootDir, args, options);
        break;
      case "run_command":
        result = await runCommandTool(rootDir, args, {
          defaultTimeoutMs: options.commandTimeoutMs,
          allowOutsideRoot: options.allowOutsideRoot,
          currentDir: options.currentDir,
        });
        break;
      case "change_dir":
        result = await changeDirTool(rootDir, args, options);
        break;
      default:
        result = { ok: false, error: `Unknown tool: ${String(name)}` };
        break;
    }

    logger.info("tool_end", {
      tool: name,
      ok: Boolean(result?.ok),
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logger.error("tool_error", {
      tool: name,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

module.exports = {
  TOOL_DECLARATIONS,
  executeToolCall,
};
