const fs = require("node:fs");
const path = require("node:path");
const manifest = require("../codex-runtime.json");

const CODEX_RUNTIME = Object.freeze({ ...manifest });

function addCandidate(candidates, candidate, source, filesystem) {
  if (!candidate) return;
  const normalized = String(candidate);
  if (candidates.some((item) => item.path.toLowerCase() === normalized.toLowerCase())) return;
  candidates.push({ path: normalized, source, present: filesystem.existsSync(normalized) });
}

function addVersionedDirectoryCandidates(candidates, directory, source, filesystem, winPath) {
  if (!directory || typeof filesystem.readdirSync !== "function") return;
  try {
    const entries = filesystem.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry?.isDirectory?.()) addCandidate(candidates, winPath.join(directory, entry.name, "codex.exe"), source, filesystem);
    }
  } catch {
    // An optional installer directory may be absent or inaccessible.
  }
}

function windowsPathCandidates({ env, resourcesPath, executablePath, filesystem }) {
  const candidates = [];
  const winPath = path.win32;
  const explicit = String(env.RADIMOAGENT_CODEX_BIN || "").trim();
  addCandidate(candidates, explicit, "environment", filesystem);

  const portableDir = String(env.PORTABLE_EXECUTABLE_DIR || "").trim();
  addCandidate(candidates, portableDir ? winPath.join(portableDir, "codex", "codex.exe") : null, "portable-adjacent", filesystem);
  addCandidate(candidates, executablePath ? winPath.join(winPath.dirname(executablePath), "codex", "codex.exe") : null, "launcher-adjacent", filesystem);
  addCandidate(candidates, resourcesPath ? winPath.join(resourcesPath, "codex", "codex.exe") : null, "packaged-resource", filesystem);

  const userProfile = String(env.USERPROFILE || "").trim();
  const codexHome = String(env.CODEX_HOME || (userProfile ? winPath.join(userProfile, ".codex") : "")).trim();
  if (codexHome) {
    addCandidate(candidates, winPath.join(codexHome, "packages", "standalone", "current", "bin", "codex.exe"), "official-installer", filesystem);
    addCandidate(candidates, winPath.join(codexHome, "packages", "standalone", "current", "codex.exe"), "official-installer-legacy", filesystem);
  }
  const localAppData = String(env.LOCALAPPDATA || "").trim();
  addCandidate(candidates, localAppData ? winPath.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe") : null, "official-installer-visible", filesystem);
  const managedCodexBin = localAppData ? winPath.join(localAppData, "OpenAI", "Codex", "bin") : null;
  addVersionedDirectoryCandidates(candidates, managedCodexBin, "official-installer-managed", filesystem, winPath);

  const appData = String(env.APPDATA || "").trim();
  if (appData) {
    addCandidate(candidates, winPath.join(appData, "npm", "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"), "official-npm-install", filesystem);
  }

  const pathValue = String(env.Path || env.PATH || "");
  for (const directory of pathValue.split(";").map((item) => item.trim()).filter(Boolean)) {
    addCandidate(candidates, winPath.join(directory, "codex.exe"), "path", filesystem);
  }

  const development = path.resolve(__dirname, "..", "vendor", "codex", "win-x64", "codex.exe");
  addCandidate(candidates, development, "development-vendor", filesystem);
  return candidates;
}

function getCodexCandidates({ platform = process.platform, env = process.env, resourcesPath = process.resourcesPath, executablePath = process.execPath, filesystem = fs } = {}) {
  if (platform !== "win32") return [{ path: String(env.RADIMOAGENT_CODEX_BIN || "/software/codex/bin/codex"), source: env.RADIMOAGENT_CODEX_BIN ? "environment" : "platform-default", present: true }];
  return windowsPathCandidates({ env, resourcesPath, executablePath, filesystem });
}

function resolveCodexBinaryInfo(options = {}) {
  const candidates = getCodexCandidates(options);
  const found = candidates.find((item) => item.present);
  if (found) return { ...found, candidates, expectedVersion: CODEX_RUNTIME.version };
  const fallback = candidates.find((item) => item.source === "packaged-resource") || candidates[0];
  return { ...(fallback || { path: "", source: "missing", present: false }), candidates, expectedVersion: CODEX_RUNTIME.version };
}

function resolveCodexBinary(options = {}) {
  return resolveCodexBinaryInfo(options).path;
}

module.exports = { CODEX_RUNTIME, getCodexCandidates, resolveCodexBinary, resolveCodexBinaryInfo };
