const path = require("node:path");
const fs = require("node:fs");

function resolveCodexBinary({ platform = process.platform, env = process.env, resourcesPath = process.resourcesPath, executablePath = process.execPath, filesystem = fs } = {}) {
  if (env.RADIMOAGENT_CODEX_BIN) return env.RADIMOAGENT_CODEX_BIN;
  if (platform === "win32") {
    if (env.PORTABLE_EXECUTABLE_DIR) return path.win32.join(env.PORTABLE_EXECUTABLE_DIR, "codex", "codex.exe");
    const adjacent = path.win32.join(path.win32.dirname(executablePath || ""), "codex", "codex.exe");
    if (adjacent && filesystem.existsSync(adjacent)) return adjacent;
    return path.win32.join(resourcesPath || path.dirname(process.execPath), "codex", "codex.exe");
  }
  return "/software/codex/bin/codex";
}

module.exports = { resolveCodexBinary };
