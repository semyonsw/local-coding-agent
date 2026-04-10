const { spawn, execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const CONTAINER_NAME = "searxng-mini";
const IMAGE = "searxng/searxng:latest";
const HOST_PORT = 8080;

function runDocker(args, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      "docker",
      args,
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error && typeof error.code === "number" ? error.code : 0,
          stdout: String(stdout || "").trim(),
          stderr: String(stderr || "").trim(),
          error: error ? error.message : null,
        });
      },
    );
  });
}

async function isDockerAvailable() {
  const result = await runDocker(["version", "--format", "{{.Server.Version}}"], {
    timeoutMs: 5000,
  });
  return result.ok && result.stdout.length > 0;
}

async function isContainerRunning(name = CONTAINER_NAME) {
  const result = await runDocker([
    "ps",
    "--filter",
    `name=^${name}$`,
    "--format",
    "{{.Names}}",
  ]);
  return result.ok && result.stdout.split("\n").includes(name);
}

async function removeExistingContainer(name = CONTAINER_NAME) {
  const exists = await runDocker([
    "ps",
    "-a",
    "--filter",
    `name=^${name}$`,
    "--format",
    "{{.Names}}",
  ]);
  if (exists.ok && exists.stdout.split("\n").includes(name)) {
    await runDocker(["rm", "-f", name]);
  }
}

async function startSearxng({ rootDir, logger, port = HOST_PORT } = {}) {
  const log = logger || {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  const available = await isDockerAvailable();
  if (!available) {
    log.warn("searxng_docker_unavailable");
    return {
      started: false,
      reason: "Docker not available. Install Docker Desktop to enable web search.",
    };
  }

  if (await isContainerRunning()) {
    log.info("searxng_already_running");
    return {
      started: true,
      adopted: true,
      reason: "Container already running, reusing existing instance.",
    };
  }

  await removeExistingContainer();

  const settingsPath = rootDir
    ? path.join(rootDir, "mini", "searxng", "settings.yml")
    : null;
  const hasSettings = settingsPath && fs.existsSync(settingsPath);

  const args = [
    "run",
    "-d",
    "--rm",
    "--name",
    CONTAINER_NAME,
    "-p",
    `${port}:8080`,
  ];
  if (hasSettings) {
    args.push("-v", `${settingsPath}:/etc/searxng/settings.yml:ro`);
  }
  args.push(IMAGE);

  log.info("searxng_starting", { hasSettings, port });
  const result = await runDocker(args, { timeoutMs: 60000 });
  if (!result.ok) {
    log.error("searxng_start_failed", {
      stderr: result.stderr,
      error: result.error,
    });
    return {
      started: false,
      reason: `Failed to start SearXNG: ${result.stderr || result.error || "unknown error"}`,
    };
  }

  log.info("searxng_started", { containerId: result.stdout });
  return { started: true, adopted: false, containerId: result.stdout };
}

async function stopSearxng({ logger } = {}) {
  const log = logger || {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  const running = await isContainerRunning();
  if (!running) {
    return { stopped: false, reason: "not_running" };
  }

  log.info("searxng_stopping");
  const result = await runDocker(["stop", CONTAINER_NAME], { timeoutMs: 30000 });
  if (!result.ok) {
    log.error("searxng_stop_failed", {
      stderr: result.stderr,
      error: result.error,
    });
    return { stopped: false, reason: result.stderr || result.error };
  }
  log.info("searxng_stopped");
  return { stopped: true };
}

module.exports = {
  startSearxng,
  stopSearxng,
  isDockerAvailable,
  CONTAINER_NAME,
};
