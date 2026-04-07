# cc-mini

A minimal runnable utility created from this leaked snapshot.

It does not depend on Bun macros, missing package manifests, or internal build tooling.
It uses plain Node.js and inspects the repository files directly.

## Run

```bash
node cc-mini.js --help
node cc-mini.js gemini-web 7789 gemini-3-flash-preview
Start.bat

node mini/cc-mini.js --help
node mini/cc-mini.js summary
node mini/cc-mini.js list commands
node mini/cc-mini.js list tools
node mini/cc-mini.js find review
node mini/cc-mini.js serve 7788
node mini/cc-mini.js gemini-web 7789 gemini-3-flash-preview
```

Then open:

- http://localhost:7788
- http://localhost:7788/summary.json

## What it gives you

- Command folder inventory from `commands/`
- Imported command symbols from `commands.ts`
- Imported tool symbols from `tools.ts`
- Keyword search across those surfaces
- Tiny HTTP dashboard for quick inspection

## Gemini Web Agent

`gemini-web` starts a local browser chat agent backed by Gemini and a tool loop.

Environment setup in `.env`:

```dotenv
GEMINI_API_KEY="your_api_key_here"
```

Optional env vars:

- `GEMINI_MODEL` (default: `gemini-3-flash-preview`)
- `GEMINI_WEB_PORT` (default: `7789`)
- `GEMINI_MAX_TURNS` (default: `10`)
- `GEMINI_MAX_TOOL_CALLS` (default: `20`)
- `GEMINI_COMMAND_TIMEOUT_MS` (default: `15000`)
- `GEMINI_TEMPERATURE` (default: `0.2`)
- `GEMINI_TOP_P` (default: `0.95`)
- `GEMINI_TOP_K` (default: `40`)
- `GEMINI_THINKING_MODE` (default: `adaptive`; options: `adaptive`, `enabled`, `disabled`)
- `GEMINI_LOG_DIR` (default: `logs`)
- `GEMINI_LOG_LEVEL` (default: `info`)
- `GEMINI_LOG_MAX_BYTES` (default: `5000000`)
- `GEMINI_SYSTEM_PROMPT` (default: empty)
- `GEMINI_ALLOW_OUTSIDE_ROOT` (default: `true`)

Logging:

- Persistent JSON-line logs are written to `logs/gemini-web-YYYY-MM-DD.log`.
- Log entries are redacted/truncated for safer diagnostics.
- Includes startup, HTTP request lifecycle, tool start/end, and error events.

Agent tools:

- `list_dir`
- `read_file`
- `write_file`
- `run_command`
- `change_dir`

Path behavior:

- By default, tools can use both workspace-relative paths and absolute paths outside the repository.
- Set `GEMINI_ALLOW_OUTSIDE_ROOT=false` to restore repo-only path sandboxing.
- After `change_dir`, relative paths are resolved from that session directory.
- Common folder aliases such as `Desktop`, `Documents`, and `Downloads` are supported in `change_dir`.

Security notes:

- Keep `.env` out of version control.
- Treat your API key as sensitive and rotate if exposed.
- Outside-root access allows file edits beyond this repository. Disable it with `GEMINI_ALLOW_OUTSIDE_ROOT=false` when needed.

## Windows One-Click Launcher

You can launch the Gemini web agent by double-clicking `Start.bat` in the project root.

- Preflight checks in `Start.bat`:
  - Node.js is installed
  - `.env` exists
  - `GEMINI_API_KEY` exists in `.env`
- Manual validation mode:
  - `Start.bat --check`
