const path = require("node:path");

function resolveCodexBinary({ platform = process.platform, env = process.env, resourcesPath = process.resourcesPath } = {}) {
  if (env.RADIMOAGENT_CODEX_BIN) return env.RADIMOAGENT_CODEX_BIN;
  if (platform === "win32") {
    return path.win32.join(resourcesPath || path.dirname(process.execPath), "codex", "codex.exe");
  }
  return "/software/codex/bin/codex";
}

module.exports = { resolveCodexBinary };
