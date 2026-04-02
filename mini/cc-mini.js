#!/usr/bin/env node

/**
 * Minimal runnable CLI built from this leaked source snapshot.
 *
 * No external dependencies required.
 * Run with: node mini/cc-mini.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const COMMANDS_DIR = path.join(ROOT, "commands");
const TOOLS_FILE = path.join(ROOT, "tools.ts");
const COMMANDS_FILE = path.join(ROOT, "commands.ts");

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function listCommandDirs() {
  if (!fs.existsSync(COMMANDS_DIR)) return [];
  return fs
    .readdirSync(COMMANDS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

function parseBuiltInCommandNames() {
  const src = safeRead(COMMANDS_FILE);
  if (!src) return [];

  // Looks for "import foo from './commands/foo/index.js'" patterns.
  const regex = /import\s+([A-Za-z0-9_]+)\s+from\s+'\.\/commands\//g;
  const names = new Set();
  let match;
  while ((match = regex.exec(src)) !== null) {
    names.add(match[1]);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function parseToolClassNames() {
  const src = safeRead(TOOLS_FILE);
  if (!src) return [];

  // Collect names imported from ./tools/* files.
  const regex = /import\s+\{?\s*([A-Za-z0-9_]+)\s*\}?\s+from\s+'\.\/tools\//g;
  const names = new Set();
  let match;
  while ((match = regex.exec(src)) !== null) {
    names.add(match[1]);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function buildSummary() {
  const commandDirs = listCommandDirs();
  const importedCommands = parseBuiltInCommandNames();
  const toolClasses = parseToolClassNames();

  return {
    root: ROOT,
    commandDirectoryCount: commandDirs.length,
    importedCommandCount: importedCommands.length,
    toolClassCount: toolClasses.length,
    commandDirs: commandDirs,
    importedCommands: importedCommands,
    toolClasses: toolClasses,
  };
}

function printHelp() {
  console.log("cc-mini: minimal runnable explorer for this codebase");
  console.log("");
  console.log("Usage:");
  console.log("  node cc-mini.js summary");
  console.log("  node cc-mini.js list commands");
  console.log("  node cc-mini.js list tools");
  console.log("  node cc-mini.js find <keyword>");
  console.log("  node cc-mini.js serve [port]");
  console.log("  node cc-mini.js gemini-web [port] [model]");
  console.log("");
  console.log("Also works:");
  console.log("  node mini/cc-mini.js summary");
  console.log("  node mini/cc-mini.js list commands");
  console.log("  node mini/cc-mini.js list tools");
  console.log("  node mini/cc-mini.js find <keyword>");
  console.log("  node mini/cc-mini.js serve [port]");
  console.log("  node mini/cc-mini.js gemini-web [port] [model]");
  console.log("");
}

function printSummary(summary) {
  console.log("Codebase summary");
  console.log("---------------");
  console.log(`Root: ${summary.root}`);
  console.log(`Command folders: ${summary.commandDirectoryCount}`);
  console.log(
    `Imported commands in commands.ts: ${summary.importedCommandCount}`,
  );
  console.log(`Imported tools in tools.ts: ${summary.toolClassCount}`);
}

function doFind(summary, keyword) {
  const q = String(keyword || "")
    .toLowerCase()
    .trim();
  if (!q) {
    console.error(
      "Provide a keyword, for example: node mini/cc-mini.js find review",
    );
    process.exitCode = 1;
    return;
  }

  const commandHits = summary.commandDirs.filter((n) =>
    n.toLowerCase().includes(q),
  );
  const importedCommandHits = summary.importedCommands.filter((n) =>
    n.toLowerCase().includes(q),
  );
  const toolHits = summary.toolClasses.filter((n) =>
    n.toLowerCase().includes(q),
  );

  console.log(`Matches for "${q}"`);
  console.log("");
  console.log(`Command folders (${commandHits.length}):`);
  for (const name of commandHits) console.log(`- ${name}`);
  console.log("");

  console.log(`Imported commands (${importedCommandHits.length}):`);
  for (const name of importedCommandHits) console.log(`- ${name}`);
  console.log("");

  console.log(`Tool classes (${toolHits.length}):`);
  for (const name of toolHits) console.log(`- ${name}`);
}

function doServe(summary, portRaw) {
  const http = require("http");
  const port = Number(portRaw) || 7788;

  const server = http.createServer((req, res) => {
    const url = req.url || "/";
    if (url === "/summary.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(summary, null, 2));
      return;
    }

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>cc-mini</title>
    <style>
      body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 2rem; background: #f5f7fb; color: #1b2430; }
      .card { background: white; border: 1px solid #d6dce5; border-radius: 12px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
      h1 { margin-top: 0; }
      ul { max-height: 240px; overflow: auto; }
      .muted { color: #5a6a7d; }
    </style>
  </head>
  <body>
    <h1>cc-mini</h1>
    <p class="muted">Minimal runnable explorer built from this repo snapshot</p>
    <div class="card">
      <strong>Command folders:</strong> ${summary.commandDirectoryCount}<br/>
      <strong>Imported commands:</strong> ${summary.importedCommandCount}<br/>
      <strong>Imported tools:</strong> ${summary.toolClassCount}
    </div>
    <div class="card">
      <h3>Sample command folders</h3>
      <ul>${summary.commandDirs
        .slice(0, 30)
        .map((n) => `<li>${n}</li>`)
        .join("")}</ul>
    </div>
    <div class="card">
      <h3>Sample tools</h3>
      <ul>${summary.toolClasses
        .slice(0, 30)
        .map((n) => `<li>${n}</li>`)
        .join("")}</ul>
    </div>
    <p><a href="/summary.json">/summary.json</a></p>
  </body>
</html>`;

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });

  server.listen(port, () => {
    console.log(`cc-mini server running on http://localhost:${port}`);
    console.log("Open /summary.json for raw data.");
  });
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";
  const summary = buildSummary();

  switch (command) {
    case "summary": {
      printSummary(summary);
      break;
    }
    case "list": {
      const sub = args[1];
      if (sub === "commands") {
        for (const name of summary.commandDirs) console.log(name);
      } else if (sub === "tools") {
        for (const name of summary.toolClasses) console.log(name);
      } else {
        console.error("Use: node mini/cc-mini.js list commands|tools");
        process.exitCode = 1;
      }
      break;
    }
    case "find": {
      doFind(summary, args[1]);
      break;
    }
    case "serve": {
      doServe(summary, args[1]);
      break;
    }
    case "gemini-web": {
      const { startGeminiWebServer } = require("./gemini-web");
      let port;
      let modelOverride;
      if (args[1] && /^\d+$/.test(args[1])) {
        port = Number(args[1]);
        modelOverride = args[2] || undefined;
      } else {
        port = undefined;
        modelOverride = args[1] || undefined;
      }
      startGeminiWebServer({ port, modelOverride });
      break;
    }
    case "help":
    case "--help":
    case "-h":
    default:
      printHelp();
  }
}

main();
