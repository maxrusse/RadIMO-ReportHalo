const fs = require("node:fs/promises");
const path = require("node:path");

const API_PROVIDERS = Object.freeze({ OPENAI: "openai", AZURE: "azure" });
const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com/v1";
const DEFAULT_API_MODEL = "gpt-5.6-luna";

function normalizeProvider(value) {
  return String(value || "").trim().toLowerCase() === API_PROVIDERS.AZURE ? API_PROVIDERS.AZURE : API_PROVIDERS.OPENAI;
}

function normalizeAuthMode(provider, value) {
  if (provider !== API_PROVIDERS.AZURE) return "bearer";
  return String(value || "").trim().toLowerCase() === "bearer" ? "bearer" : "api-key";
}

function isLoopbackHostname(hostname) {
  const value = String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function assertSecureApiUrl(url, label = "API-Endpunkt") {
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) return url;
  throw new Error(`${label} muss HTTPS verwenden. HTTP ist nur für localhost/127.0.0.1/::1 erlaubt.`);
}

function normalizeEndpoint(provider, value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return provider === API_PROVIDERS.OPENAI ? DEFAULT_OPENAI_ENDPOINT : "";
  let url;
  try { url = new URL(raw); } catch { throw new Error("API-Endpunkt muss mit http:// oder https:// beginnen."); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("API-Endpunkt muss eine sichere HTTP(S)-Adresse ohne Zugangsdaten sein.");
  assertSecureApiUrl(url);
  let normalized = url.toString().replace(/\/+$/, "");
  if (provider === API_PROVIDERS.AZURE) {
    if (/\/openai\/v1$/i.test(normalized)) return normalized;
    normalized = `${normalized}/openai/v1`;
  } else if (!/\/v1$/i.test(normalized)) {
    normalized = `${normalized}/v1`;
  }
  return normalized;
}

function normalizeModel(value, provider) {
  const model = String(value || "").trim();
  if (model) return model.slice(0, 160);
  return provider === API_PROVIDERS.AZURE ? "" : DEFAULT_API_MODEL;
}

function normalizeAudioDeployment(value) {
  return String(value || "").trim().slice(0, 160);
}

function normalizeAudioApiVersion(value) {
  const version = String(value || "").trim();
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:-preview)?$/.test(version) ? version : "2024-10-21";
}

function normalizeConfig(value = {}) {
  const provider = normalizeProvider(value.provider);
  return {
    provider,
    authMode: normalizeAuthMode(provider, value.authMode),
    endpoint: normalizeEndpoint(provider, value.endpoint),
    model: normalizeModel(value.model, provider),
    audioDeployment: normalizeAudioDeployment(value.audioDeployment),
    audioApiVersion: normalizeAudioApiVersion(value.audioApiVersion),
  };
}

function configPath(userDataPath) {
  return path.join(userDataPath, "agent-api-config.json");
}

function credentialPath(userDataPath) {
  return path.join(userDataPath, "secrets", "agent-api-key.bin");
}

function envConfig(env = process.env) {
  const azureDetected = Boolean(env.AZURE_OPENAI_ENDPOINT || env.AZURE_OPENAI_API_KEY || env.AZURE_OPENAI_DEPLOYMENT || env.AZURE_OPENAI_AUDIO_DEPLOYMENT || env.AZURE_OPENAI_BEARER_TOKEN || env.RADIMOAGENT_AZURE_BEARER_TOKEN);
  const explicitProvider = String(env.RADIMOAGENT_API_PROVIDER || "").trim();
  const provider = explicitProvider ? normalizeProvider(explicitProvider) : azureDetected ? API_PROVIDERS.AZURE : API_PROVIDERS.OPENAI;
  const azure = provider === API_PROVIDERS.AZURE;
  const azureBearer = env.RADIMOAGENT_AZURE_BEARER_TOKEN || env.AZURE_OPENAI_BEARER_TOKEN;
  const azureKey = env.RADIMOAGENT_API_KEY || env.AZURE_OPENAI_API_KEY;
  const authMode = azure
    ? (env.RADIMOAGENT_AZURE_AUTH_MODE ? normalizeAuthMode(provider, env.RADIMOAGENT_AZURE_AUTH_MODE) : azureBearer?.trim() ? "bearer" : azureKey?.trim() ? "api-key" : null)
    : "bearer";
  const endpoint = env.RADIMOAGENT_API_BASE_URL || (azure ? env.AZURE_OPENAI_ENDPOINT : env.OPENAI_BASE_URL) || null;
  return {
    provider: explicitProvider || azureDetected ? provider : null,
    authMode,
    endpoint,
    model: env.RADIMOAGENT_API_MODEL || (azure ? env.AZURE_OPENAI_DEPLOYMENT : null),
    audioDeployment: env.RADIMOAGENT_API_AUDIO_DEPLOYMENT || (azure ? env.AZURE_OPENAI_AUDIO_DEPLOYMENT : null),
    audioApiVersion: env.RADIMOAGENT_AZURE_AUDIO_API_VERSION || (azure ? env.AZURE_OPENAI_AUDIO_API_VERSION : null),
    providerLocked: Boolean(env.RADIMOAGENT_API_PROVIDER || azureDetected),
    authModeLocked: Boolean(env.RADIMOAGENT_AZURE_AUTH_MODE || azureBearer?.trim() || azureKey?.trim()),
    endpointLocked: Boolean(endpoint),
    modelLocked: Boolean(env.RADIMOAGENT_API_MODEL || (azure && env.AZURE_OPENAI_DEPLOYMENT)),
    audioDeploymentLocked: Boolean(env.RADIMOAGENT_API_AUDIO_DEPLOYMENT || (azure && env.AZURE_OPENAI_AUDIO_DEPLOYMENT)),
    audioApiVersionLocked: Boolean(env.RADIMOAGENT_AZURE_AUDIO_API_VERSION || (azure && env.AZURE_OPENAI_AUDIO_API_VERSION)),
  };
}

async function readApiConfig({ userDataPath, env = process.env } = {}) {
  if (!userDataPath) throw new Error("API configuration path is required.");
  let stored = {};
  try { stored = JSON.parse(await fs.readFile(configPath(userDataPath), "utf8")); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const overrides = envConfig(env);
  const provider = overrides.provider || stored.provider || API_PROVIDERS.OPENAI;
  const authMode = overrides.authMode || stored.authMode || "";
  const endpoint = overrides.endpoint || stored.endpoint || "";
  const model = overrides.model || stored.model || "";
  const audioDeployment = overrides.audioDeployment || stored.audioDeployment || "";
  const audioApiVersion = overrides.audioApiVersion || stored.audioApiVersion || "";
  const config = normalizeConfig({ provider, authMode, endpoint, model, audioDeployment, audioApiVersion });
  return {
    ...config,
    providerLocked: overrides.providerLocked,
    authModeLocked: overrides.authModeLocked,
    endpointLocked: overrides.endpointLocked,
    modelLocked: overrides.modelLocked,
    audioDeploymentLocked: overrides.audioDeploymentLocked,
    audioApiVersionLocked: overrides.audioApiVersionLocked,
  };
}

async function saveApiConfig({ userDataPath, patch = {}, env = process.env } = {}) {
  const current = await readApiConfig({ userDataPath, env: {} });
  const providerChanged = patch.provider !== undefined && normalizeProvider(patch.provider) !== current.provider;
  const authMode = patch.authMode !== undefined ? patch.authMode : providerChanged ? "" : current.authMode;
  const next = normalizeConfig({ ...current, ...patch, authMode });
  const overrides = envConfig(env);
  const effective = await readApiConfig({ userDataPath, env });
  if (overrides.providerLocked && patch.provider !== undefined && next.provider !== effective.provider) throw new Error("Der API-Provider ist per Umgebungsvariable festgelegt.");
  if (overrides.authModeLocked && patch.authMode !== undefined && next.authMode !== effective.authMode) throw new Error("Der Azure-Zugangstyp ist per Umgebungsvariable festgelegt.");
  if (overrides.endpointLocked && patch.endpoint !== undefined && next.endpoint !== effective.endpoint) throw new Error("Der API-Endpunkt ist per Umgebungsvariable festgelegt.");
  if (overrides.modelLocked && patch.model !== undefined && next.model !== effective.model) throw new Error("Das API-Modell ist per Umgebungsvariable festgelegt.");
  if (overrides.audioDeploymentLocked && patch.audioDeployment !== undefined && next.audioDeployment !== effective.audioDeployment) throw new Error("Das Azure-Audio-Deployment ist per Umgebungsvariable festgelegt.");
  if (overrides.audioApiVersionLocked && patch.audioApiVersion !== undefined && next.audioApiVersion !== effective.audioApiVersion) throw new Error("Die Azure-Audio-API-Version ist per Umgebungsvariable festgelegt.");
  const target = configPath(userDataPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  return readApiConfig({ userDataPath, env });
}

function validateAgentApiCredential(value, provider = API_PROVIDERS.OPENAI) {
  const credential = String(value || "").trim();
  if (!credential || /\s/.test(credential) || credential.length < 8) {
    throw new Error(provider === API_PROVIDERS.AZURE ? "Azure-API-Key oder Bearer-Token eingeben." : "Gültigen API-Key eingeben.");
  }
  if (credential.length > 4096) throw new Error("API-Zugangsdaten sind ungewöhnlich lang.");
  return credential;
}

function environmentCredential(config, env = process.env) {
  if (config.provider === API_PROVIDERS.AZURE) {
    const bearer = env.RADIMOAGENT_AZURE_BEARER_TOKEN || env.AZURE_OPENAI_BEARER_TOKEN;
    if (bearer?.trim()) return { key: validateAgentApiCredential(bearer, config.provider), source: "environment", authMode: "bearer" };
    const key = env.RADIMOAGENT_API_KEY || env.AZURE_OPENAI_API_KEY;
    if (key?.trim()) return { key: validateAgentApiCredential(key, config.provider), source: "environment", authMode: "api-key" };
    return null;
  }
  const key = env.RADIMOAGENT_API_KEY || env.OPENAI_API_KEY;
  return key?.trim() ? { key: validateAgentApiCredential(key, config.provider), source: "environment", authMode: "bearer" } : null;
}

async function readApiCredential({ userDataPath, config, safeStorage, env = process.env, fallback = null } = {}) {
  const environment = environmentCredential(config, env);
  if (environment) return environment;
  if (safeStorage?.isEncryptionAvailable?.()) {
    try {
      const encrypted = await fs.readFile(credentialPath(userDataPath));
      return { key: validateAgentApiCredential(safeStorage.decryptString(encrypted), config.provider), source: "encrypted-local", authMode: normalizeAuthMode(config.provider, config.authMode) };
    } catch {
      // A stale or unreadable local value must not prevent an environment or
      // compatibility fallback from being considered below.
    }
  }
  if (fallback) return { ...fallback, source: fallback.source || "fallback", authMode: fallback.authMode || "bearer" };
  return null;
}

async function saveApiCredential({ userDataPath, safeStorage, value, provider, authMode } = {}) {
  const key = validateAgentApiCredential(value, provider);
  const normalizedAuthMode = normalizeAuthMode(provider, authMode);
  if (!safeStorage?.isEncryptionAvailable?.()) throw new Error("Windows-Verschlüsselung ist für diese App-Sitzung nicht verfügbar.");
  const target = credentialPath(userDataPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, safeStorage.encryptString(key), { encoding: "binary", mode: 0o600 });
  return { configured: true, source: "encrypted-local", authMode: normalizedAuthMode };
}

async function clearApiCredential({ userDataPath } = {}) {
  await fs.rm(credentialPath(userDataPath), { force: true });
  return { configured: false };
}

module.exports = {
  API_PROVIDERS,
  assertSecureApiUrl,
  isLoopbackHostname,
  DEFAULT_API_MODEL,
  DEFAULT_OPENAI_ENDPOINT,
  clearApiCredential,
  configPath,
  credentialPath,
  environmentCredential,
  envConfig,
  normalizeConfig,
  normalizeAuthMode,
  normalizeAudioDeployment,
  normalizeAudioApiVersion,
  normalizeEndpoint,
  normalizeProvider,
  readApiConfig,
  readApiCredential,
  saveApiConfig,
  saveApiCredential,
  validateAgentApiCredential,
};
