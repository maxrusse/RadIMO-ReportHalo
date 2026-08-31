const { radimoBackend: packageBackend } = require("../package.json");

const VALID_BACKENDS = new Set(["codex", "api"]);

function normalizeBackend(value) {
  const backend = String(value || "").trim().toLowerCase();
  return VALID_BACKENDS.has(backend) ? backend : "codex";
}

const BACKEND_MODE = normalizeBackend(process.env.RADIMOAGENT_BACKEND || packageBackend);

function getBackendInfo(mode = BACKEND_MODE) {
  const backend = normalizeBackend(mode);
  return backend === "api"
    ? { backend, label: "Direkte API", authMode: "api-key", subscriptionManaged: false }
    : { backend, label: "Codex-Abo", authMode: "chatgpt-or-api", subscriptionManaged: true };
}

module.exports = { BACKEND_MODE, VALID_BACKENDS, getBackendInfo, normalizeBackend };
