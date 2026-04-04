const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * Session persistence: save/load/delete sessions as JSON files on disk.
 * Each session is stored as `sessions/{id}.json`.
 */

async function ensureDir(dir) {
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
}

async function saveSession(sessionsDir, session) {
  await ensureDir(sessionsDir);
  const filePath = path.join(sessionsDir, `${session.id}.json`);
  const tmpPath = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  const data = {
    id: session.id,
    contents: session.contents,
    totalToolCalls: session.totalToolCalls,
    currentDir: session.currentDir,
    createdAt: session.createdAt,
    lastAccessedAt: session.lastAccessedAt,
  };
  await fs.promises.writeFile(tmpPath, JSON.stringify(data), "utf8");
  await fs.promises.rename(tmpPath, filePath);
}

async function loadAllSessions(sessionsDir, logger) {
  const sessions = new Map();
  try {
    await fs.promises.access(sessionsDir);
  } catch {
    return sessions;
  }

  let entries;
  try {
    entries = await fs.promises.readdir(sessionsDir);
  } catch {
    return sessions;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const filePath = path.join(sessionsDir, entry);
    try {
      const raw = await fs.promises.readFile(filePath, "utf8");
      const data = JSON.parse(raw);
      if (!data.id || !Array.isArray(data.contents)) continue;
      sessions.set(data.id, {
        id: data.id,
        contents: data.contents,
        totalToolCalls: data.totalToolCalls || 0,
        currentDir: data.currentDir || null,
        createdAt: data.createdAt || Date.now(),
        lastAccessedAt: data.lastAccessedAt || Date.now(),
      });
    } catch (err) {
      if (logger) {
        logger.warn("session_load_skip", { file: entry, error: err.message });
      }
    }
  }

  return sessions;
}

async function deleteSession(sessionsDir, id) {
  const filePath = path.join(sessionsDir, `${id}.json`);
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

module.exports = {
  saveSession,
  loadAllSessions,
  deleteSession,
};
