const path = require("node:path");
const { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, net, safeStorage, screen, session, shell } = require("electron");
const { createAgentBackend } = require("./agent-backend");
const { BACKEND_MODE, getBackendInfo } = require("./runtime-config");
const { TEXT_ACTION_OUTPUT_SCHEMA } = require("./text-contract");
const { findAdjacentContext, formatContextReport } = require("./context-finder");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { configure, getLogPath, log, readLog } = require("./logger");
const { focusMappedField, readFocusedField, scanFieldWindow: scanRawFieldWindow, writeFocusedField } = require("./windows-field-bridge");
const {
  buildFieldMapReport,
  loadFieldMapperProfile,
  normalizeFieldMapperProfile,
  parseRuleText,
  profileSummary: fieldMapperProfileSummary,
  saveFieldMapperProfile,
} = require("./windows-field-mapper");
const { parseProxyInput, proxyEndpointFromRules } = require("./windows-proxy");
const { readReferencePack, readReferenceUrl } = require("./reference-library");
const { clinicSummary, formatClinicSourcePrompt, loadClinicSourceLibrary, readClinicSource, saveClinicRoot } = require("./clinic-source-library");
const {
  formatGuidancePrompt,
  loadGuidanceProfile,
  parseGuidanceMarkdown,
  profileDirectory,
  profileSummary,
  saveGuidanceProfile,
  serializeGuidanceMarkdown,
} = require("./report-writing-guidance");
const { loadTemplateLibrary, templateSummary } = require("./template-library");
const { createWorkflowStore } = require("./workflow-state");
const { restoreClipboard, snapshotClipboard } = require("./clipboard-transfer");
const { DEFAULT_TRANSCRIPTION_MODEL, probeTranscriptionModel, transcribeAudio, transcribeAzureAudio, validateApiKey } = require("./openai-audio");
const {
  API_PROVIDERS,
  clearApiCredential,
  readApiConfig,
  readApiCredential,
  saveApiConfig,
  saveApiCredential,
  isLoopbackHostname,
} = require("./agent-api-config");
const {
  DEFAULT_DAILY_TOKEN_LIMIT,
  DEFAULT_MONTHLY_TOKEN_LIMIT,
  DEFAULT_USD_TO_EUR,
  UsageBudget,
  tokenCount,
} = require("./usage-budget");

const APP_NAME = "RadIMO - ReportHalo";
const MAX_AGENT_TURN_CHARS = 120_000;
// Keep the compositor on the normal path. A transparent, frameless window is
// still much cheaper to move with GPU compositing than with a forced software
// renderer. Set RADIMO_SOFTWARE_RENDERING=1 only for machines that need the
// compatibility fallback.
if (process.env.RADIMO_SOFTWARE_RENDERING === "1") {
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("in-process-gpu");
  app.disableHardwareAcceleration();
}
let agentClient = null;
let agentStartPromise = null;
let usageBudget = null;
let currentThreadId = null;
let helperWindowRef = null;
let runtimeProxyOverride = null;
let snipWindowRef = null;
let pendingSnip = null;
let snipCompleting = false;
let guidanceLoaded = null;
let templateLibraryLoaded = null;
let clinicSourceLibraryLoaded = null;
let fieldMapperProfileLoaded = null;
let helperBoundsSaveTimer = null;
let helperCubeModeSaveTimer = null;
const pendingCapturePaths = new Set();
const workflowStore = createWorkflowStore();
// Both modes remain floating Cub surfaces. The compact mode is the default
// because it must sit above the user's RIS/editor without obscuring it.
const HELPER_CUBE_MODES = {
  compact: {
    size: { width: 180, height: 190 },
    layout: { padding: 4, mainWidth: 172, anchorX: 74, anchorY: 79, chatMainHeight: 182 },
  },
  standard: {
    size: { width: 360, height: 380 },
    layout: { padding: 8, mainWidth: 344, anchorX: 163.5, anchorY: 172, chatMainHeight: 326 },
  },
};
let helperCubeMode = "compact";
const HELPER_PANEL_SIZES = {
  chat: { width: 680, height: 820 },
  workspace: { width: 980, height: 640 },
  editor: { width: 700, height: 520 },
  review: { width: 700, height: 520 },
  context: { width: 820, height: 560 },
  config: { width: 700, height: 520 },
  settings: { width: 700, height: 620 },
};

function currentHelperCube() {
  return HELPER_CUBE_MODES[helperCubeMode] || HELPER_CUBE_MODES.compact;
}
const HELPER_TOGGLE_SHORTCUT = "CommandOrControl+Shift+Space";
const DICTATION_SHORTCUT = "CommandOrControl+Shift+D";
const FIELD_CAPTURE_SHORTCUT = "CommandOrControl+Shift+G";
let shortcutRegistration = { toggle: false, dictation: false, capture: false };
let helperPanelKey = "base";
let helperPanelSide = "right";
let helperPanelVertical = "bottom";
let helperPanelRequestEpoch = "";
let latestHelperPanelRequest = 0;
let quitting = false;

function openAICredentialPath() {
  return path.join(app.getPath("userData"), "secrets", "openai-api-key.bin");
}

async function readOpenAIKey() {
  if (process.env.OPENAI_API_KEY?.trim()) return { key: validateApiKey(process.env.OPENAI_API_KEY), source: "environment" };
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const encrypted = await fs.readFile(openAICredentialPath());
    return { key: validateApiKey(safeStorage.decryptString(encrypted)), source: "encrypted-local" };
  } catch (error) {
    if (error?.code !== "ENOENT") log("WARN", "Stored OpenAI API credential could not be read", { message: error?.message || String(error) });
    return null;
  }
}

async function saveOpenAIKey(value) {
  const key = validateApiKey(value);
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is not available for this app session.");
  const target = openAICredentialPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, safeStorage.encryptString(key), { mode: 0o600 });
  return { configured: true, source: "encrypted-local", transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL };
}

async function clearOpenAIKey() {
  await fs.rm(openAICredentialPath(), { force: true });
  return openAIStatus();
}

async function openAIStatus() {
  const credential = await readOpenAIKey();
  return {
    configured: Boolean(credential),
    source: credential?.source || null,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL,
  };
}

function getUsageBudget() {
  if (!usageBudget) {
    usageBudget = new UsageBudget({
      filePath: path.join(app.getPath("userData"), "usage-budget.json"),
      dailyLimit: DEFAULT_DAILY_TOKEN_LIMIT,
      monthlyLimit: DEFAULT_MONTHLY_TOKEN_LIMIT,
      usdToEur: DEFAULT_USD_TO_EUR,
    });
  }
  return usageBudget;
}

async function readAgentApiConfig() {
  return readApiConfig({ userDataPath: app.getPath("userData") });
}

async function readAgentApiCredential(config) {
  const resolvedConfig = config || await readAgentApiConfig();
  const fallback = resolvedConfig.provider === API_PROVIDERS.OPENAI ? await readOpenAIKey() : null;
  return readApiCredential({
    userDataPath: app.getPath("userData"),
    config: resolvedConfig,
    safeStorage,
    fallback,
  });
}

async function agentApiStatus() {
  const config = await readAgentApiConfig();
  const credential = await readAgentApiCredential(config);
  const transcriptionCredential = await readOpenAIKey();
  const azureAudioConfigured = config.provider === API_PROVIDERS.AZURE && Boolean(credential && config.endpoint && config.audioDeployment);
  const openAiAudioConfigured = Boolean(transcriptionCredential) || (config.provider === API_PROVIDERS.OPENAI && Boolean(credential));
  return {
    backend: "api",
    provider: config.provider,
    endpoint: config.endpoint,
    model: config.model,
    audioDeployment: config.audioDeployment,
    audioApiVersion: config.audioApiVersion,
    configured: Boolean(credential),
    dictationConfigured: azureAudioConfigured || openAiAudioConfigured,
    dictationMode: azureAudioConfigured ? "azure" : openAiAudioConfigured ? "openai" : null,
    dictationSource: azureAudioConfigured ? credential?.source || null : transcriptionCredential?.source || (config.provider === API_PROVIDERS.OPENAI ? credential?.source || null : null),
    dictationEncryptionAvailable: safeStorage.isEncryptionAvailable(),
    source: credential?.source || null,
    authMode: credential?.authMode || config.authMode || null,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    providerLocked: Boolean(config.providerLocked),
    authModeLocked: Boolean(config.authModeLocked),
    endpointLocked: Boolean(config.endpointLocked),
    modelLocked: Boolean(config.modelLocked),
    audioDeploymentLocked: Boolean(config.audioDeploymentLocked),
    audioApiVersionLocked: Boolean(config.audioApiVersionLocked),
    usage: await getUsageBudget().status(),
  };
}

function helperWindowStatePath() {
  return path.join(app.getPath("userData"), "reporthalo-window.json");
}

function visibleHelperBounds(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return null;
  const display = screen.getAllDisplays().find((item) => {
    const area = item.workArea;
    return bounds.x + bounds.width / 2 >= area.x && bounds.x + bounds.width / 2 <= area.x + area.width && bounds.y + bounds.height / 2 >= area.y && bounds.y + bounds.height / 2 <= area.y + area.height;
  }) || screen.getPrimaryDisplay();
  const area = display.workArea;
  const size = currentHelperCube().size;
  const x = Math.min(Math.max(Math.round(bounds.x), area.x), area.x + Math.max(0, area.width - size.width));
  const y = Math.min(Math.max(Math.round(bounds.y), area.y), area.y + Math.max(0, area.height - size.height));
  return {
    x,
    y,
    width: size.width,
    height: size.height,
  };
}

async function loadHelperBounds() {
  try {
    const stored = JSON.parse(await fs.readFile(helperWindowStatePath(), "utf8"));
    helperCubeMode = normalizeHelperCubeMode(stored?.cubeMode);
    return visibleHelperBounds(stored?.bounds);
  } catch {
    return null;
  }
}

function saveHelperBoundsSoon() {
  if (!helperWindowRef || helperWindowRef.isDestroyed()) return;
  if (helperPanelKey !== "base") return;
  if (helperBoundsSaveTimer) clearTimeout(helperBoundsSaveTimer);
  helperBoundsSaveTimer = setTimeout(async () => {
    if (!helperWindowRef || helperWindowRef.isDestroyed()) return;
    if (helperPanelKey !== "base") return;
    const [x, y] = helperWindowRef.getPosition();
    const bounds = { x, y, ...currentHelperCube().size };
    await fs.writeFile(helperWindowStatePath(), JSON.stringify({ bounds, cubeMode: helperCubeMode }, null, 2), { encoding: "utf8", mode: 0o600 }).catch((error) => {
      log("WARN", "Helper window position could not be saved", { message: error?.message || String(error) });
    });
  }, 250);
}

function saveHelperCubeModeSoon() {
  if (!helperWindowRef || helperWindowRef.isDestroyed()) return;
  if (helperCubeModeSaveTimer) clearTimeout(helperCubeModeSaveTimer);
  helperCubeModeSaveTimer = setTimeout(async () => {
    if (!helperWindowRef || helperWindowRef.isDestroyed()) return;
    let stored = {};
    try {
      stored = JSON.parse(await fs.readFile(helperWindowStatePath(), "utf8"));
    } catch {
      stored = {};
    }
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) stored = {};
    stored.cubeMode = helperCubeMode;
    await fs.writeFile(helperWindowStatePath(), JSON.stringify(stored, null, 2), { encoding: "utf8", mode: 0o600 }).catch((error) => {
      log("WARN", "Helper window size mode could not be saved", { message: error?.message || String(error) });
    });
  }, 250);
}

function broadcastWorkflowState() {
  sendToRenderer("workflow:state", workflowStore.get());
  return workflowStore.get();
}

async function ensureGuidanceProfile() {
  if (!guidanceLoaded) guidanceLoaded = loadGuidanceProfile({ appRoot: path.join(__dirname, ".."), executablePath: process.execPath, resourcesPath: process.resourcesPath, userDataPath: app.getPath("userData") });
  return guidanceLoaded;
}

async function ensureTemplateLibrary() {
  if (!templateLibraryLoaded) templateLibraryLoaded = loadTemplateLibrary({ executablePath: process.execPath, resourcesPath: process.resourcesPath, appRoot: path.join(__dirname, ".."), userDataPath: app.getPath("userData"), webServerEnabled: false });
  return templateLibraryLoaded;
}

async function ensureClinicSourceLibrary({ reload = false } = {}) {
  if (!clinicSourceLibraryLoaded || reload) clinicSourceLibraryLoaded = loadClinicSourceLibrary({ appRoot: path.join(__dirname, ".."), executablePath: process.execPath, resourcesPath: process.resourcesPath, userDataPath: app.getPath("userData") });
  return clinicSourceLibraryLoaded;
}

async function ensureFieldMapperProfile({ reload = false } = {}) {
  if (!fieldMapperProfileLoaded || reload) fieldMapperProfileLoaded = loadFieldMapperProfile(app.getPath("userData"));
  return fieldMapperProfileLoaded;
}

async function applyGuidance(options = {}) {
  const loaded = await ensureGuidanceProfile();
  const writingProfile = options.writingProfile || "off";
  return {
    ...options,
    writingGuidance: writingProfile === "german-radiology" ? formatGuidancePrompt(loaded.profile) : "",
  };
}

async function resolveCodexEnvironment() {
  const { applyCodexProxy } = require("./codex-proxy-env");
  const env = { ...process.env };
  if (runtimeProxyOverride?.mode === "direct") {
    for (const key of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) delete env[key];
    log("INFO", "Using explicit direct connection for Codex", { configured: false });
    return env;
  }
  const explicitProxy = runtimeProxyOverride?.mode === "fixed_servers" ? runtimeProxyOverride.endpoint : null;
  if (explicitProxy) {
    const noProxyAdjusted = applyCodexProxy(env, explicitProxy);
    log("INFO", `Using explicit ${APP_NAME} proxy override for Codex`, { configured: true, noProxyAdjusted });
    return env;
  }
  if (runtimeProxyOverride?.mode === "pac_script") {
    try {
      const rules = await session.defaultSession.resolveProxy("https://auth.openai.com/");
      const proxy = proxyEndpointFromRules(rules);
      if (proxy) {
        const noProxyAdjusted = applyCodexProxy(env, proxy);
        log("INFO", "Resolved explicit PAC proxy for Codex", { rules, appliedProxy: "yes", noProxyAdjusted });
      } else {
        log("INFO", "Explicit PAC resolved to a direct Codex connection", { rules, appliedProxy: "no" });
      }
      return env;
    } catch (error) {
      log("WARN", "Could not resolve explicit PAC proxy for Codex", { message: error?.message || String(error) });
      return env;
    }
  }
  const inheritedProxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (inheritedProxy) {
    const noProxyAdjusted = applyCodexProxy(env, inheritedProxy);
    log("INFO", "Using inherited proxy environment for Codex", { configured: true, noProxyAdjusted });
    return env;
  }
  let rules = null;
  try {
    rules = await session.defaultSession.resolveProxy("https://auth.openai.com/");
    const proxy = proxyEndpointFromRules(rules);
    const noProxyAdjusted = proxy && !env.HTTPS_PROXY && !env.https_proxy && !env.HTTP_PROXY && !env.http_proxy
      ? applyCodexProxy(env, proxy)
      : false;
    log("INFO", "Resolved system proxy for Codex", { rules, appliedProxy: proxy ? "yes" : "no", noProxyAdjusted });
  } catch (error) {
    log("WARN", "Could not resolve system proxy for Codex", { message: error?.message || String(error) });
  }
  return env;
}

function proxyWithCredentials(value, username, password) {
  const config = parseProxyInput(value);
  const user = String(username || "");
  const secret = String(password || "");
  if ((!user && secret) || (user && !secret)) throw new Error("Enter both proxy username and proxy password, or leave both blank.");
  if (!user && !secret && config.mode !== "fixed_servers") return config;
  if (config.mode !== "fixed_servers") throw new Error("Proxy credentials can only be used with a fixed IP/hostname proxy, not with a PAC script.");
  const parsed = new URL(config.endpoint);
  const sessionProxy = new URL(config.proxyRules);
  const embeddedUser = decodeURIComponent(parsed.username || "");
  const embeddedPassword = decodeURIComponent(parsed.password || "");
  if ((!user && embeddedPassword) || (user && !secret && !embeddedPassword) || (!user && secret)) {
    throw new Error("Enter both proxy username and proxy password, or leave both blank.");
  }
  if (!user && !secret && !embeddedUser && !embeddedPassword) return config;
  parsed.username = user || embeddedUser;
  parsed.password = secret || embeddedPassword;
  sessionProxy.username = "";
  sessionProxy.password = "";
  const endpoint = parsed.toString().replace(/\/$/, "");
  const proxyRules = sessionProxy.toString().replace(/\/$/, "");
  return { ...config, proxyRules, endpoint, username: user || embeddedUser, password: secret || embeddedPassword };
}

function proxyConfigured(value) {
  return Boolean(value && value.mode !== "system" && value.configured !== false);
}

async function applySessionProxy(config) {
  const effective = config || { mode: "system", configured: false };
  if (effective.mode === "pac_script") {
    await session.defaultSession.setProxy({ mode: "pac_script", pacScript: effective.pacScript });
  } else if (effective.mode === "fixed_servers") {
    await session.defaultSession.setProxy({ mode: "fixed_servers", proxyRules: effective.proxyRules });
  } else if (effective.mode === "direct") {
    await session.defaultSession.setProxy({ mode: "direct" });
  } else {
    await session.defaultSession.setProxy({ mode: "system" });
  }
  await session.defaultSession.closeAllConnections?.();
}

async function restartAgentWithProxy(value) {
  const request = typeof value === "object" && value !== null ? value : { url: value };
  const nextProxy = proxyWithCredentials(
    String(request.url || "").trim(),
    request.username,
    request.password,
  );
  await applySessionProxy(nextProxy);
  runtimeProxyOverride = nextProxy.mode === "system" ? null : nextProxy;
  if (BACKEND_MODE === "api") {
    currentThreadId = null;
    if (agentClient?.resetConversation) await agentClient.resetConversation();
    log("INFO", "Direct API proxy updated", { configured: proxyConfigured(runtimeProxyOverride), mode: nextProxy.mode });
    return { configured: proxyConfigured(runtimeProxyOverride), mode: nextProxy.mode };
  }
  if (agentClient) {
    agentClient.close();
    agentClient = null;
  }
  agentStartPromise = null;
  currentThreadId = null;
  await ensureAgent();
  log("INFO", "Codex restarted after proxy change", { configured: proxyConfigured(runtimeProxyOverride), mode: nextProxy.mode });
  return { configured: proxyConfigured(runtimeProxyOverride), mode: nextProxy.mode };
}

function isAllowedExternalUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { return false; }
  return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHostname(url.hostname));
}

function hardenLocalWebContents(webContents) {
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-navigate", (event) => event.preventDefault());
}

async function probeAuthEndpoint() {
  try {
    const response = await net.fetch("https://auth.openai.com/", { signal: AbortSignal.timeout(10000) });
    return {
      status: response.status,
      reachable: true,
      proxyAuthenticate: response.headers.get("proxy-authenticate")?.slice(0, 160) || null,
    };
  } catch (error) {
    return { reachable: false, error: error?.message || String(error) };
  }
}

async function windowsProxyDiagnostics() {
  try {
    const rules = await session.defaultSession.resolveProxy("https://auth.openai.com/");
    return {
      source: "electron-session",
      rules,
      endpoint: proxyEndpointFromRules(rules),
      explicitMode: runtimeProxyOverride?.mode || "system",
    };
  } catch (error) {
    return { source: "electron-session", error: error?.message || String(error), explicitMode: runtimeProxyOverride?.mode || "system" };
  }
}

function sendToRenderer(channel, payload) {
  if (helperWindowRef && !helperWindowRef.isDestroyed()) helperWindowRef.webContents.send(channel, payload);
}

const SNIP_IPC_CHANNELS = new Set(["snip:finish", "snip:cancel"]);

function trustedIpcSender(event, windowRef) {
  return Boolean(windowRef && !windowRef.isDestroyed() && event?.sender === windowRef.webContents);
}

function registerIpcHandler(channel, handler) {
  return ipcMain.handle(channel, (event, ...args) => {
    const windowRef = SNIP_IPC_CHANNELS.has(channel) ? snipWindowRef : helperWindowRef;
    if (!trustedIpcSender(event, windowRef)) throw new Error("Unzulässiger IPC-Absender.");
    return handler(event, ...args);
  });
}

function isLocalCapturePath(value) {
  if (typeof value !== "string" || path.extname(value).toLowerCase() !== ".png") return false;
  const base = path.resolve(app.getPath("temp"));
  const candidate = path.resolve(value);
  return candidate.startsWith(`${base}${path.sep}`);
}

async function cleanupCapturePaths() {
  for (const capturePath of pendingCapturePaths) await fs.rm(capturePath, { force: true }).catch(() => {});
  pendingCapturePaths.clear();
}

async function releaseCapturePath(value) {
  if (!isLocalCapturePath(value)) return false;
  const capturePath = path.resolve(value);
  if (!pendingCapturePaths.has(capturePath)) return false;
  pendingCapturePaths.delete(capturePath);
  await fs.rm(capturePath, { force: true }).catch(() => {});
  return true;
}

function handleAgentNotification(message) {
  sendToRenderer("agent:event", message);
  if (message.method !== "item/agentMessage/delta") log(message.method === "radimoagent/stderr" ? "WARN" : "INFO", message.method || "Agent event", message.params);
  if (message.method === "turn/completed") {
    workflowStore.patch({ phase: "ready" });
    broadcastWorkflowState();
  }
}

async function createAgentClient() {
  const options = {
    cwd: app.getPath("documents"),
    onNotification: handleAgentNotification,
  };
  if (BACKEND_MODE === "codex") {
    options.env = await resolveCodexEnvironment();
  } else {
    options.getConfig = readAgentApiConfig;
    options.getCredential = readAgentApiCredential;
    options.clearCredential = async () => clearApiCredential({ userDataPath: app.getPath("userData") });
    options.fetchImpl = (url, requestOptions) => net.fetch(url, requestOptions);
    options.usageBudget = getUsageBudget();
  }
  return createAgentBackend(options);
}

async function ensureAgent() {
  if (!agentClient && !agentStartPromise) {
    agentStartPromise = createAgentClient().then(async (client) => {
      agentClient = client;
      await client.start();
      return client;
    }).catch((error) => {
      agentClient = null;
      throw error;
    }).finally(() => { agentStartPromise = null; });
  }
  if (agentStartPromise) await agentStartPromise;
  return agentClient;
}

async function createHelperWindow() {
  if (helperWindowRef && !helperWindowRef.isDestroyed()) {
    helperWindowRef.showInactive();
    if (process.platform === "win32") helperWindowRef.setFocusable(false);
    return helperWindowRef;
  }
  const savedBounds = await loadHelperBounds();
  const size = currentHelperCube().size;
  helperWindowRef = new BrowserWindow({
    width: size.width,
    height: size.height,
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : { center: true }),
    minWidth: HELPER_CUBE_MODES.compact.size.width,
    minHeight: HELPER_CUBE_MODES.compact.size.height,
    maxWidth: 1080,
    maxHeight: 840,
    frame: false,
    transparent: true,
    show: false,
    focusable: process.platform !== "win32",
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: APP_NAME,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // The Windows sandbox cannot launch a renderer in some managed desktop
      // environments. The UI only loads local, bundled files and keeps the
      // stronger isolation boundaries above.
      sandbox: false,
    },
  });
  helperWindowRef.setAlwaysOnTop(true, "floating");
  hardenLocalWebContents(helperWindowRef.webContents);
  if (process.platform === "win32") helperWindowRef.setFocusable(false);
  helperWindowRef.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    log("ERROR", "Helper renderer failed to load", { errorCode, errorDescription, validatedURL, isMainFrame });
  });
  helperWindowRef.webContents.on("render-process-gone", (_event, details) => {
    log("ERROR", "Helper renderer exited", details);
  });
  helperWindowRef.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) log("WARN", "Helper renderer console message", { level, message, line, sourceId });
  });
  helperWindowRef.webContents.once("did-finish-load", () => {
    helperWindowRef.showInactive();
    if (agentClient) sendToRenderer("agent:ready", { appName: APP_NAME, ...getBackendInfo() });
  });
  helperWindowRef.on("move", saveHelperBoundsSoon);
  helperWindowRef.on("system-context-menu", (event, params = {}) => {
    if (params.isEditable || params.selectionText) return;
    event.preventDefault();
    sendToRenderer("helper:context-menu", { target: "miniCore" });
  });
  helperWindowRef.on("closed", () => {
    if (helperBoundsSaveTimer) clearTimeout(helperBoundsSaveTimer);
    if (helperCubeModeSaveTimer) clearTimeout(helperCubeModeSaveTimer);
    helperBoundsSaveTimer = null;
    helperCubeModeSaveTimer = null;
    helperWindowRef = null;
  });
  try {
    await helperWindowRef.loadFile(path.join(__dirname, "renderer", "index.html"), { query: { mode: "helper" } });
  } catch (error) {
    log("ERROR", "Helper window could not load", { message: error?.message || String(error) });
    throw error;
  }
  return helperWindowRef;
}

function helperNativeWindowHandle() {
  try {
    const value = helperWindowRef?.getNativeWindowHandle();
    if (!value?.length) return "";
    return value.length >= 8 ? value.readBigUInt64LE(0).toString() : String(value.readUInt32LE(0));
  } catch {
    return "";
  }
}

function waitForExternalFocus() {
  return new Promise((resolve) => setTimeout(resolve, 140));
}

async function withHelperTemporarilyHidden(task) {
  const helper = helperWindowRef;
  if (process.platform !== "win32" || !helper || helper.isDestroyed() || !helper.isVisible()) return task();
  const wasFocusable = typeof helper.isFocusable === "function" ? helper.isFocusable() : false;
  helper.setFocusable(false);
  helper.hide();
  await waitForExternalFocus();
  try {
    return await task();
  } finally {
    if (!helper.isDestroyed()) {
      helper.setFocusable(wasFocusable);
      helper.showInactive();
    }
  }
}

function normalizeHelperCubeMode(value) {
  return Object.prototype.hasOwnProperty.call(HELPER_CUBE_MODES, value) ? value : "compact";
}

function setHelperCubeMode(mode) {
  const nextMode = normalizeHelperCubeMode(mode);
  if (nextMode === helperCubeMode) return { mode: helperCubeMode, ...currentHelperCube().size };
  const previousCube = currentHelperCube();
  let anchor = null;
  if (helperWindowRef && !helperWindowRef.isDestroyed()) {
    const current = helperWindowRef.getBounds();
    const previousExtraWidth = Math.max(0, current.width - previousCube.size.width);
    const previousChatPanelHeight = Math.max(0, current.height - (previousCube.layout.padding * 2) - previousCube.layout.chatMainHeight);
    anchor = {
      x: current.x + previousCube.layout.anchorX + (helperPanelSide === "left" ? previousExtraWidth : 0),
      y: current.y + previousCube.layout.anchorY + (helperPanelKey === "chat" && helperPanelVertical === "top" ? previousChatPanelHeight : 0),
    };
  }
  helperCubeMode = nextMode;
  saveHelperCubeModeSoon();
  const layout = helperWindowRef && !helperWindowRef.isDestroyed()
    ? setHelperPanelSize(helperPanelKey, anchor)
    : currentHelperCube().size;
  return { mode: helperCubeMode, ...layout };
}

function setHelperPanelSize(panel = "base", anchorOverride = null) {
  const cube = currentHelperCube();
  const baseSize = cube.size;
  const layout = cube.layout;
  const size = panel === "base" ? baseSize : HELPER_PANEL_SIZES[panel] || baseSize;
  if (!helperWindowRef || helperWindowRef.isDestroyed()) return size;
  const display = screen.getDisplayMatching(helperWindowRef.getBounds());
  const area = display.workArea;
  const current = helperWindowRef.getBounds();
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  const previousExtraWidth = Math.max(0, current.width - baseSize.width);
  const previousChatPanelHeight = Math.max(0, current.height - (layout.padding * 2) - layout.chatMainHeight);
  const anchor = anchorOverride || {
    x: current.x + layout.anchorX + (helperPanelSide === "left" ? previousExtraWidth : 0),
    y: current.y + layout.anchorY + (helperPanelKey === "chat" && helperPanelVertical === "top" ? previousChatPanelHeight : 0),
  };
  const extraWidth = Math.max(0, width - baseSize.width);
  const sidePanel = panel !== "base" && panel !== "chat";
  const rightFits = anchor.x - layout.anchorX + width <= area.x + area.width;
  const leftFits = anchor.x - layout.anchorX - extraWidth >= area.x;
  helperPanelSide = sidePanel && !rightFits && leftFits ? "left" : "right";
  const chatPanelHeight = Math.max(0, height - (layout.padding * 2) - layout.chatMainHeight);
  const bottomFits = anchor.y - layout.anchorY + height <= area.y + area.height;
  const topFits = anchor.y - layout.anchorY - chatPanelHeight >= area.y;
  helperPanelVertical = panel === "chat" && !bottomFits && topFits ? "top" : "bottom";
  let x = helperPanelSide === "left" ? anchor.x - layout.anchorX - extraWidth : anchor.x - layout.anchorX;
  let y = panel === "chat" && helperPanelVertical === "top" ? anchor.y - layout.anchorY - chatPanelHeight : anchor.y - layout.anchorY;
  x = Math.min(Math.max(Math.round(x), area.x), area.x + Math.max(0, area.width - width));
  y = Math.min(Math.max(Math.round(y), area.y), area.y + Math.max(0, area.height - height));
  helperPanelKey = panel;
  helperWindowRef.setBounds({ x, y, width, height });
  saveHelperBoundsSoon();
  return { width, height, x, y, side: helperPanelSide, vertical: helperPanelVertical };
}

async function toggleHelperWindow() {
  if (helperWindowRef && !helperWindowRef.isDestroyed() && helperWindowRef.isVisible()) {
    helperWindowRef.hide();
    return false;
  }
  await createHelperWindow();
  return true;
}

function helperShortcutStatus() {
  return {
    ready: Object.values(shortcutRegistration).every(Boolean),
    shortcuts: {
      toggle: { accelerator: HELPER_TOGGLE_SHORTCUT, registered: shortcutRegistration.toggle },
      dictation: { accelerator: DICTATION_SHORTCUT, registered: shortcutRegistration.dictation },
      capture: { accelerator: FIELD_CAPTURE_SHORTCUT, registered: shortcutRegistration.capture },
    },
  };
}

function registerHelperShortcuts({ retry = false } = {}) {
  if (retry) {
    for (const shortcut of [HELPER_TOGGLE_SHORTCUT, DICTATION_SHORTCUT, FIELD_CAPTURE_SHORTCUT]) globalShortcut.unregister(shortcut);
  }
  const toggleRegistered = globalShortcut.register(HELPER_TOGGLE_SHORTCUT, () => { void toggleHelperWindow(); });
  const dictationRegistered = globalShortcut.register(DICTATION_SHORTCUT, async () => {
    const point = process.platform === "win32" ? screen.getCursorScreenPoint() : null;
    const helper = await createHelperWindow();
    if (process.platform === "win32") helper.setFocusable(false);
    helper.showInactive();
    helper.webContents.send("helper:toggle-dictation", { point });
  });
  const captureRegistered = globalShortcut.register(FIELD_CAPTURE_SHORTCUT, async () => {
    const point = process.platform === "win32" ? screen.getCursorScreenPoint() : null;
    const helper = await createHelperWindow();
    if (process.platform === "win32") helper.setFocusable(false);
    helper.showInactive();
    helper.webContents.send("helper:capture-field", { point });
  });
  shortcutRegistration = { toggle: toggleRegistered, dictation: dictationRegistered, capture: captureRegistered };
  log(toggleRegistered && dictationRegistered && captureRegistered ? "INFO" : "WARN", "Global helper shortcuts registered", {
    toggle: toggleRegistered ? HELPER_TOGGLE_SHORTCUT : null,
    dictation: dictationRegistered ? DICTATION_SHORTCUT : null,
    capture: captureRegistered ? FIELD_CAPTURE_SHORTCUT : null,
  });
  return helperShortcutStatus();
}

function closeSnipWindow() {
  if (snipWindowRef && !snipWindowRef.isDestroyed()) snipWindowRef.close();
  snipWindowRef = null;
}

async function captureScreenRegion(rect) {
  const display = pendingSnip?.display || screen.getPrimaryDisplay();
  const bounds = pendingSnip?.bounds || display.bounds;
  const width = Math.max(1, Math.round(Number(rect?.width) || 0));
  const height = Math.max(1, Math.round(Number(rect?.height) || 0));
  if (width < 3 || height < 3) return null;
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: Math.max(1, Math.round(bounds.width * display.scaleFactor)),
      height: Math.max(1, Math.round(bounds.height * display.scaleFactor)),
    },
    fetchWindowIcons: false,
  });
  const source = sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];
  if (!source?.thumbnail || source.thumbnail.isEmpty()) throw new Error("No screen image was available.");
  const image = source.thumbnail;
  const scaleX = image.getSize().width / bounds.width;
  const scaleY = image.getSize().height / bounds.height;
  const crop = {
    x: Math.max(0, Math.min(image.getSize().width - 1, Math.round((Number(rect.x) || 0) * scaleX))),
    y: Math.max(0, Math.min(image.getSize().height - 1, Math.round((Number(rect.y) || 0) * scaleY))),
    width: Math.max(1, Math.min(image.getSize().width, Math.round(width * scaleX))),
    height: Math.max(1, Math.min(image.getSize().height, Math.round(height * scaleY))),
  };
  crop.width = Math.min(crop.width, image.getSize().width - crop.x);
  crop.height = Math.min(crop.height, image.getSize().height - crop.y);
  const cropped = image.crop(crop);
  const capturePath = path.join(app.getPath("temp"), `radimoagent-capture-${crypto.randomUUID()}.png`);
  await fs.writeFile(capturePath, cropped.toPNG());
  pendingCapturePaths.add(capturePath);
  return { ok: true, dataUrl: cropped.toDataURL(), path: capturePath, width: crop.width, height: crop.height };
}

registerIpcHandler("screen:snip", async () => {
  if (pendingSnip) throw new Error("A screen capture is already in progress.");
  const display = screen.getPrimaryDisplay();
  const bounds = display.bounds;
  return new Promise((resolve, reject) => {
    pendingSnip = { resolve, reject, display, bounds };
    snipWindowRef = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      fullscreenable: false,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: path.join(__dirname, "snip-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    snipWindowRef.setAlwaysOnTop(true, "screen-saver");
    hardenLocalWebContents(snipWindowRef.webContents);
    snipWindowRef.loadFile(path.join(__dirname, "renderer", "snip.html"));
    snipWindowRef.once("ready-to-show", () => snipWindowRef.showInactive());
    snipWindowRef.on("closed", () => {
      if (pendingSnip && !snipCompleting) {
        pendingSnip.resolve(null);
        pendingSnip = null;
      }
      snipWindowRef = null;
    });
  });
});

registerIpcHandler("snip:finish", async (_event, rect) => {
  if (!pendingSnip) return null;
  const request = pendingSnip;
  try {
    snipCompleting = true;
    closeSnipWindow();
    const result = await captureScreenRegion(rect);
    request.resolve(result);
    return { accepted: true };
  } catch (error) {
    request.reject(error);
    return { accepted: false };
  } finally {
    pendingSnip = null;
    snipCompleting = false;
  }
});

registerIpcHandler("snip:cancel", () => {
  if (pendingSnip) pendingSnip.resolve(null);
  pendingSnip = null;
  closeSnipWindow();
  return true;
});

registerIpcHandler("screen:release", async (_event, capturePath) => releaseCapturePath(capturePath));

registerIpcHandler("snip:copy", (_event, dataUrl) => {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return false;
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) return false;
  clipboard.writeImage(image);
  log("INFO", "Screen capture copied to clipboard", { width: image.getSize().width, height: image.getSize().height });
  return true;
});

registerIpcHandler("agent:status", async () => {
  const client = await ensureAgent();
  return { ...getBackendInfo(), ...(await client.authStatus()) };
});

registerIpcHandler("agent:browser-login", async () => {
  if (BACKEND_MODE !== "codex") throw new Error("Die API-Version verwendet keinen Browser-Login. Bitte den API-Key in den Einstellungen hinterlegen.");
  const client = await ensureAgent();
  log("INFO", "Starting ChatGPT browser login");
  try {
    const result = await client.startBrowserLogin();
    if (result?.authUrl) {
      if (!isAllowedExternalUrl(result.authUrl)) throw new Error("Codex returned an unsafe browser-login URL.");
      await shell.openExternal(result.authUrl);
    }
    log("INFO", "ChatGPT browser login URL opened", { hasUrl: Boolean(result?.authUrl), loginId: Boolean(result?.loginId) });
    return result;
  } catch (error) {
    log("ERROR", "ChatGPT browser login failed", { message: error?.message || String(error) });
    const message = error?.message || String(error);
    if (/auth\.openai\.com|login|sending request/i.test(message)) {
      throw new Error(`${message}\n\nThe browser login could not be started by the local Codex app-server. Check Windows proxy/VPN/firewall settings, then use “Copy diagnostics”.`);
    }
    throw error;
  }
});

registerIpcHandler("agent:logout", async () => {
  const result = await (await ensureAgent()).logout();
  currentThreadId = null;
  return result;
});
registerIpcHandler("agent:new-discussion", async () => {
  currentThreadId = null;
  if (agentClient?.resetConversation) await agentClient.resetConversation();
  return { ok: true };
});
registerIpcHandler("agent:models", async () => {
  try {
    const result = await (await ensureAgent()).listModels();
    log("INFO", "Model catalog loaded", { count: Array.isArray(result?.data) ? result.data.length : 0 });
    return result;
  } catch (error) {
    log("ERROR", "Model catalog failed", { message: error?.message || String(error) });
    throw error;
  }
});
registerIpcHandler("agent:open-url", async (_event, url) => {
  if (!isAllowedExternalUrl(url)) return false;
  await shell.openExternal(url);
  return true;
});
registerIpcHandler("agent:copy-diagnostics", async () => {
  const diagnostics = await (async () => ({
    path: getLogPath(),
    proxyRules: await session.defaultSession.resolveProxy("https://auth.openai.com/").catch((error) => `ERROR: ${error.message}`),
    proxyOverrideConfigured: proxyConfigured(runtimeProxyOverride) || Boolean(process.env.RADIMOAGENT_HTTPS_PROXY || process.env.RADIMOAGENT_HTTP_PROXY),
    windowsProxy: await windowsProxyDiagnostics(),
    authEndpoint: await probeAuthEndpoint(),
    runtime: {
      app: APP_NAME,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      node: process.versions.node,
      backend: getBackendInfo(),
      codex: BACKEND_MODE === "codex" ? agentClient?.bin || require("./platform").resolveCodexBinary() : null,
      api: BACKEND_MODE === "api" ? await agentApiStatus() : null,
    },
    text: await readLog(),
  }))();
  const text = [
    `${APP_NAME} diagnostics`,
    `Log path: ${diagnostics.path || "not initialized"}`,
    `Runtime: ${JSON.stringify(diagnostics.runtime)}`,
    "",
    diagnostics.text,
    `Proxy rules: ${diagnostics.proxyRules}`,
    `Proxy override configured: ${diagnostics.proxyOverrideConfigured}`,
    `Windows proxy settings: ${JSON.stringify(diagnostics.windowsProxy)}`,
    `Auth endpoint: ${JSON.stringify(diagnostics.authEndpoint)}`,
  ].join("\n");
  clipboard.writeText(text);
  log("INFO", "Diagnostics copied to clipboard");
  return { path: diagnostics.path, bytes: Buffer.byteLength(text) };
});
registerIpcHandler("agent:test-connection", async () => {
  if (BACKEND_MODE === "api") {
    const result = await (await ensureAgent()).testConnection();
    return {
      ...result,
      proxyRules: await session.defaultSession.resolveProxy(result.endpoint || "https://api.openai.com/").catch((error) => `ERROR: ${error.message}`),
      proxyOverrideConfigured: proxyConfigured(runtimeProxyOverride) || Boolean(process.env.RADIMOAGENT_HTTPS_PROXY || process.env.RADIMOAGENT_HTTP_PROXY),
    };
  }
  const proxyRules = await session.defaultSession.resolveProxy("https://auth.openai.com/").catch((error) => `ERROR: ${error.message}`);
  return {
    proxyRules,
    proxyEndpoint: proxyEndpointFromRules(proxyRules),
    authEndpoint: await probeAuthEndpoint(),
    proxyOverrideConfigured: proxyConfigured(runtimeProxyOverride) || Boolean(process.env.RADIMOAGENT_HTTPS_PROXY || process.env.RADIMOAGENT_HTTP_PROXY),
    windowsProxy: await windowsProxyDiagnostics(),
  };
});
registerIpcHandler("agent:set-proxy", async (_event, value) => restartAgentWithProxy(value));
registerIpcHandler("agent:api-status", async () => agentApiStatus());
registerIpcHandler("agent:api-set-config", async (_event, patch) => {
  if (BACKEND_MODE !== "api") throw new Error("API-Konfiguration gehört zur direkten API-Version.");
  const before = await readAgentApiConfig();
  const result = await saveApiConfig({ userDataPath: app.getPath("userData"), patch: patch && typeof patch === "object" ? patch : {} });
  if (before.provider !== result.provider) await clearApiCredential({ userDataPath: app.getPath("userData") });
  currentThreadId = null;
  if (agentClient?.resetConversation) await agentClient.resetConversation();
  return { ...result, status: await agentApiStatus() };
});
registerIpcHandler("agent:api-set-key", async (_event, value) => {
  if (BACKEND_MODE !== "api") throw new Error("API-Zugang gehört zur direkten API-Version.");
  const config = await readAgentApiConfig();
  const request = value && typeof value === "object" ? value : { value };
  const authMode = request.authMode || config.authMode;
  if (config.provider === API_PROVIDERS.AZURE && request.authMode) {
    await saveApiConfig({ userDataPath: app.getPath("userData"), patch: { authMode: request.authMode } });
  }
  const result = await saveApiCredential({ userDataPath: app.getPath("userData"), safeStorage, value: request.value, provider: config.provider, authMode });
  log("INFO", "Direct API credential saved", { provider: config.provider, source: result.source });
  return { ...result, status: await agentApiStatus() };
});
registerIpcHandler("agent:api-clear-key", async () => {
  if (BACKEND_MODE !== "api") throw new Error("API-Zugang gehört zur direkten API-Version.");
  const result = await clearApiCredential({ userDataPath: app.getPath("userData") });
  if (agentClient?.resetConversation) await agentClient.resetConversation();
  log("INFO", "Stored direct API credential removed");
  return { ...result, status: await agentApiStatus() };
});
registerIpcHandler("agent:api-test", async () => {
  if (BACKEND_MODE !== "api") throw new Error("Direkter API-Test ist in der Codex-Version nicht erforderlich.");
  const result = await (await ensureAgent()).testConnection();
  const status = await agentApiStatus();
  log("INFO", "Direct API readiness passed", { provider: result.provider, model: result.model, dictationMode: status.dictationMode });
  return { ...result, audioConfigured: status.dictationConfigured, dictationMode: status.dictationMode };
});
registerIpcHandler("agent:usage", async () => BACKEND_MODE === "api"
  ? getUsageBudget().status()
  : ({ enabled: false, estimateOnly: true, message: "Codex-Abonutzung wird vom Anbieter verwaltet." }));
registerIpcHandler("openai:status", () => openAIStatus());
registerIpcHandler("openai:test", async () => {
  if (BACKEND_MODE === "api") {
    const config = await readAgentApiConfig();
    if (config.provider === API_PROVIDERS.AZURE) {
      const azureCredential = await readAgentApiCredential(config);
      if (azureCredential && config.audioDeployment) return { ok: true, model: config.audioDeployment, provider: "azure", configured: true };
    }
  }
  let credential = await readOpenAIKey();
  if (!credential && BACKEND_MODE === "api") {
    const config = await readAgentApiConfig();
    const candidate = await readAgentApiCredential(config);
    if (config.provider === API_PROVIDERS.OPENAI && candidate) credential = candidate;
  }
  if (!credential) throw new Error("OpenAI API key missing. Save a key before testing dictation.");
  const result = await probeTranscriptionModel({ apiKey: credential.key, fetchImpl: (url, options) => net.fetch(url, options) });
  log("INFO", "OpenAI transcription readiness passed", { model: result.model, source: credential.source });
  return result;
});
registerIpcHandler("openai:set-key", async (_event, value) => {
  const result = await saveOpenAIKey(value);
  log("INFO", "OpenAI transcription credential saved", { source: result.source });
  return result;
});
registerIpcHandler("openai:clear-key", async () => {
  const result = await clearOpenAIKey();
  log("INFO", "Stored OpenAI transcription credential removed", { environmentConfigured: result.source === "environment" });
  return result;
});
registerIpcHandler("helper:shortcut-status", () => helperShortcutStatus());
registerIpcHandler("helper:retry-shortcuts", () => registerHelperShortcuts({ retry: true }));
registerIpcHandler("audio:transcribe", async (_event, payload) => {
  const audioBudget = BACKEND_MODE === "api" ? getUsageBudget() : null;
  const audioBytes = Number(payload?.bytes?.byteLength || payload?.bytes?.length || 0);
  const estimatedAudioTokens = audioBudget ? Math.max(256, Math.ceil(audioBytes / 1024)) : 0;
  const reservation = audioBudget ? await audioBudget.check({ estimatedInputTokens: estimatedAudioTokens }) : null;
  try {
    let result;
  if (BACKEND_MODE === "api") {
    const config = await readAgentApiConfig();
    if (config.provider === API_PROVIDERS.AZURE) {
      const azureCredential = await readAgentApiCredential(config);
      if (azureCredential && config.audioDeployment) {
        result = await transcribeAzureAudio({
          payload,
          apiKey: azureCredential.key,
          authMode: azureCredential.authMode,
          endpoint: config.endpoint,
          deployment: config.audioDeployment,
          apiVersion: config.audioApiVersion,
          prompt: payload?.prompt,
          fetchImpl: (url, options) => net.fetch(url, options),
        });
        log("INFO", "Azure dictation transcribed", { model: result.model, bytes: result.bytes, chars: result.text.length });
        if (audioBudget) await audioBudget.record({ model: result.model, reservationId: reservation?.reservationId, estimatedInputTokens: estimatedAudioTokens, estimatedOutputTokens: tokenCount(result.text) });
        return result;
      }
    }
  }
  let credential = await readOpenAIKey();
  if (!credential && BACKEND_MODE === "api") {
    const config = await readAgentApiConfig();
    const candidate = await readAgentApiCredential(config);
    if (config.provider === API_PROVIDERS.OPENAI && candidate) credential = candidate;
  }
  if (!credential) throw new Error("OpenAI API key missing. Open Konto and configure dictation first.");
  result = await transcribeAudio({ payload, apiKey: credential.key, prompt: payload?.prompt, fetchImpl: (url, options) => net.fetch(url, options) });
  log("INFO", "Dictation transcribed", { model: result.model, bytes: result.bytes, chars: result.text.length });
  if (audioBudget) await audioBudget.record({ model: result.model, reservationId: reservation?.reservationId, estimatedInputTokens: estimatedAudioTokens, estimatedOutputTokens: tokenCount(result.text) });
  return result;
  } catch (error) {
    if (audioBudget && reservation?.reservationId) audioBudget.release(reservation.reservationId);
    throw error;
  }
});
registerIpcHandler("guidance:status", async () => profileSummary(await ensureGuidanceProfile()));
registerIpcHandler("templates:status", async () => templateSummary(await ensureTemplateLibrary()));
registerIpcHandler("templates:get", async (_event, id) => {
  const library = await ensureTemplateLibrary();
  return library.templates.find((template) => template.id === id) || null;
});
registerIpcHandler("guidance:import", async () => {
  const result = await dialog.showOpenDialog(helperWindowRef, {
    title: "Import German radiology writing profile",
    properties: ["openFile"],
    filters: [{ name: "Editable Markdown guidance", extensions: ["md", "markdown"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const imported = await fs.readFile(result.filePaths[0], "utf8");
  const saved = await saveGuidanceProfile(app.getPath("userData"), parseGuidanceMarkdown(imported));
  guidanceLoaded = saved;
  log("INFO", "German radiology writing profile imported", profileSummary(saved));
  return profileSummary(saved);
});
registerIpcHandler("guidance:export", async () => {
  const loaded = await ensureGuidanceProfile();
  const result = await dialog.showSaveDialog(helperWindowRef, {
    title: "Export German radiology writing profile",
    defaultPath: "german-radiology-profile.md",
    filters: [{ name: "Markdown profile", extensions: ["md"] }],
  });
  if (result.canceled || !result.filePath) return null;
  const content = serializeGuidanceMarkdown(loaded.profile);
  await fs.writeFile(result.filePath, content, "utf8");
  return { filePath: result.filePath, bytes: Buffer.byteLength(content) };
});
registerIpcHandler("guidance:open-folder", async () => {
  const folder = profileDirectory(app.getPath("userData"));
  await fs.mkdir(folder, { recursive: true });
  await shell.openPath(folder);
  return folder;
});
registerIpcHandler("clinic:status", async () => clinicSummary(await ensureClinicSourceLibrary({ reload: true })));
registerIpcHandler("clinic:choose-root", async () => {
  const result = await dialog.showOpenDialog(helperWindowRef, {
    title: "Klinikquellen-Ordner wählen",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const root = await saveClinicRoot(app.getPath("userData"), result.filePaths[0]);
  clinicSourceLibraryLoaded = loadClinicSourceLibrary({ appRoot: path.join(__dirname, ".."), executablePath: process.execPath, resourcesPath: process.resourcesPath, userDataPath: app.getPath("userData") });
  log("INFO", "Clinic source root selected", { root });
  return clinicSummary(await clinicSourceLibraryLoaded);
});
registerIpcHandler("clinic:open-root", async () => {
  const library = await ensureClinicSourceLibrary();
  await fs.mkdir(library.root, { recursive: true });
  await shell.openPath(library.root);
  return library.root;
});
registerIpcHandler("clinic:read-source", async (_event, payload) => {
  const library = await ensureClinicSourceLibrary({ reload: true });
  const source = await readClinicSource(library, payload?.clinicId, payload?.sourcePath);
  log("INFO", "Clinic PDF read and registered", {
    clinicId: source.clinicId,
    source: source.relativePath,
    status: source.status,
    sha256: source.sha256,
    agentsPath: source.agentsPath,
  });
  return { ...source, prompt: formatClinicSourcePrompt(source), catalog: clinicSummary(await ensureClinicSourceLibrary({ reload: true })) };
});
registerIpcHandler("clipboard:write", (_event, text) => {
  if (typeof text !== "string") throw new Error("Clipboard content must be text.");
  clipboard.writeText(text);
  return true;
});
registerIpcHandler("clipboard:read", () => clipboard.readText());
registerIpcHandler("field:read-focused", async (_event, options) => {
  const request = options || {};
  const hasPoint = request.pointX !== "" && request.pointY !== "" && Number.isFinite(Number(request.pointX)) && Number.isFinite(Number(request.pointY));
  const releaseHelper = request.accessMode !== "clipboard" && !request.windowHandle && !hasPoint;
  let pointScale = "";
  if (hasPoint && process.platform === "win32") {
    try { pointScale = screen.getDisplayNearestPoint({ x: Number(request.pointX), y: Number(request.pointY) }).scaleFactor || ""; } catch { /* display lookup is optional */ }
  }
  const run = releaseHelper ? withHelperTemporarilyHidden : async (task) => task();
  const result = await run(() => readFocusedField({ ...request, pointScale, helperWindowHandle: helperNativeWindowHandle(), helperProcessId: process.pid }));
  log(result?.ok ? "INFO" : "WARN", "Focused field capture", {
    ok: Boolean(result?.ok),
    strategy: result?.strategy || null,
    supportsWrite: Boolean(result?.supportsWrite),
    error: result?.error || null,
  });
  return result;
});
registerIpcHandler("field:focus-mapped", async (_event, payload) => {
  const result = await focusMappedField({
    windowHandle: payload?.windowHandle,
    target: payload?.target,
    helperWindowHandle: helperNativeWindowHandle(),
    helperProcessId: process.pid,
  });
  log(result?.ok ? "INFO" : "WARN", "Mapped field focus", {
    ok: Boolean(result?.ok),
    verified: Boolean(result?.verified),
    error: result?.error || null,
  });
  return result;
});
registerIpcHandler("field:write-focused", async (_event, payload) => {
  if (!payload || typeof payload.text !== "string") return { ok: false, verified: false, error: "empty-text" };
  const previousClipboard = snapshotClipboard(clipboard);
  clipboard.writeText(payload.text);
  try {
    const result = await writeFocusedField(payload);
    log(result?.ok ? "INFO" : "WARN", "Focused field write", {
      ok: Boolean(result?.ok),
      verified: Boolean(result?.verified),
      strategy: result?.strategy || null,
      readable: Boolean(result?.readable),
      error: result?.error || null,
    });
    return result;
  } finally {
    restoreClipboard(clipboard, previousClipboard);
  }
});
registerIpcHandler("field-mapper:status", async () => fieldMapperProfileSummary(await ensureFieldMapperProfile(), app.getPath("userData")));
registerIpcHandler("field-mapper:set-config", async (_event, payload) => {
  const profile = parseRuleText(payload?.includeText, payload?.excludeText);
  fieldMapperProfileLoaded = await saveFieldMapperProfile(app.getPath("userData"), profile);
  log("INFO", "Field mapper profile saved", {
    includeRules: fieldMapperProfileLoaded.include.length,
    excludePatterns: fieldMapperProfileLoaded.exclude.length,
  });
  return fieldMapperProfileSummary(fieldMapperProfileLoaded, app.getPath("userData"));
});
registerIpcHandler("field:scan-window", async (_event, payload) => {
  const profile = await ensureFieldMapperProfile();
  const readValues = payload?.readValues !== false;
  const request = payload || {};
  const requestedWindow = request.windowHandle || request.target?.windowHandle || "";
  const releaseHelper = request.accessMode !== "clipboard" && !requestedWindow;
  const run = releaseHelper ? withHelperTemporarilyHidden : async (task) => task();
  const raw = await run(() => scanRawFieldWindow({
    windowHandle: request.windowHandle,
    target: request.target,
    helperWindowHandle: helperNativeWindowHandle(),
    helperProcessId: process.pid,
    accessMode: request.accessMode,
    profile,
    readValues,
  }));
  if (!raw?.ok) {
    log("WARN", "Field mapper scan failed", { error: raw?.error || "unknown", windowHandle: raw?.windowHandle || null });
    return raw;
  }
  const report = buildFieldMapReport(raw, profile, { readValues });
  log("INFO", "Field mapper scan completed", {
    processName: report.source.processName || null,
    processId: report.source.processId || null,
    scanned: report.diagnostics.scanned,
    textFields: report.diagnostics.textFields,
    matchedFields: report.diagnostics.matchedFields,
    excludedFields: report.diagnostics.excludedFields,
    readValues,
  });
  return report;
});
registerIpcHandler("workflow:get", () => workflowStore.get());
registerIpcHandler("workflow:new-case", (_event, payload) => {
  const result = workflowStore.startCase(payload || {});
  broadcastWorkflowState();
  return result;
});
registerIpcHandler("workflow:patch", (_event, payload) => {
  const result = workflowStore.patch(payload || {});
  broadcastWorkflowState();
  return result;
});
registerIpcHandler("workflow:add-artifact", (_event, payload) => {
  const result = workflowStore.addArtifact(payload || {});
  broadcastWorkflowState();
  log("INFO", "Workflow artifact added", {
    caseId: result.caseId,
    kind: payload?.kind || "draft",
    chars: typeof payload?.text === "string" ? payload.text.length : 0,
  });
  return result;
});
registerIpcHandler("ui:set-helper-focusable", (_event, value) => {
  if (helperWindowRef && !helperWindowRef.isDestroyed() && process.platform === "win32") {
    helperWindowRef.setFocusable(Boolean(value));
    if (!value) helperWindowRef.blur();
  }
  return true;
});
registerIpcHandler("ui:set-helper-cube-mode", (_event, mode) => setHelperCubeMode(mode));
registerIpcHandler("ui:set-helper-panel", (_event, payload) => {
  const request = payload && typeof payload === "object" ? payload : null;
  const requestId = Number(request?.requestId || 0);
  const epoch = String(request?.epoch || "");
  if (requestId > 0) {
    if (epoch && epoch !== helperPanelRequestEpoch) {
      helperPanelRequestEpoch = epoch;
      latestHelperPanelRequest = 0;
    }
    if (requestId < latestHelperPanelRequest) return { stale: true, requestId };
    latestHelperPanelRequest = requestId;
  }
  const panel = typeof payload === "string" ? payload : request?.panel;
  return { ...setHelperPanelSize(typeof panel === "string" ? panel : "base"), requestId };
});
registerIpcHandler("ui:hide-helper", () => {
  if (helperWindowRef && !helperWindowRef.isDestroyed()) helperWindowRef.hide();
  return true;
});
registerIpcHandler("app:quit", () => {
  app.quit();
  return true;
});

registerIpcHandler("context:choose", async () => {
  const result = await dialog.showOpenDialog(helperWindowRef, {
    title: "Choose a report file for context beta",
    properties: ["openFile"],
    filters: [
      { name: "Reports and text", extensions: ["txt", "md", "json", "csv", "xml", "html", "pdf"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return findAdjacentContext(result.filePaths[0]);
});

registerIpcHandler("context:save-report", async (_event, report) => {
  if (!report || typeof report !== "object" || !report.source?.path) throw new Error("No context report is available.");
  const result = await dialog.showSaveDialog(helperWindowRef, {
    title: "Save ReportHalo context report",
    defaultPath: "radimoagent-context-beta-report.md",
    filters: [{ name: "Markdown report", extensions: ["md"] }, { name: "Text report", extensions: ["txt"] }],
  });
  if (result.canceled || !result.filePath) return null;
  const reportText = formatContextReport(report);
  await fs.writeFile(result.filePath, reportText, "utf8");
  return { filePath: result.filePath, bytes: Buffer.byteLength(reportText) };
});
registerIpcHandler("context:save-draft", async (_event, payload) => {
  if (!payload?.sourcePath || typeof payload.content !== "string" || !payload.content.trim()) throw new Error("No reviewed correction draft is available.");
  const source = path.resolve(payload.sourcePath);
  const parsed = path.parse(source);
  const result = await dialog.showSaveDialog(helperWindowRef, {
    title: "Save reviewed ReportHalo draft",
    defaultPath: path.join(parsed.dir, `${parsed.name}.radimoagent-draft${parsed.ext || ".txt"}`),
    filters: [{ name: "Text draft", extensions: [parsed.ext.replace(".", "") || "txt"] }, { name: "All files", extensions: ["*"] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, payload.content, "utf8");
  log("INFO", "Reviewed correction draft saved", { filePath: result.filePath });
  return { filePath: result.filePath, bytes: Buffer.byteLength(payload.content) };
});

registerIpcHandler("reference:choose", async () => {
  const result = await dialog.showOpenDialog(helperWindowRef, {
    title: "Choose local radiology references",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Readable reference text", extensions: ["txt", "md", "markdown", "html", "htm", "json", "csv", "xml"] },
      { name: "Reference files (traceability only)", extensions: ["pdf"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const pack = await readReferencePack(result.filePaths);
  log("INFO", "Local reference pack selected", {
    files: pack.length,
    readable: pack.filter((item) => item.status === "ready").length,
    metadataOnly: pack.filter((item) => item.status === "metadata-only").length,
  });
  return pack;
});

registerIpcHandler("reference:fetch-url", async (_event, value) => {
  const reference = await readReferenceUrl(value, (url, options) => net.fetch(url, options));
  log("INFO", "Medical reference URL fetched locally", {
    host: new URL(reference.url).hostname,
    status: reference.status,
    chars: reference.content.length,
  });
  return reference;
});

registerIpcHandler("agent:turn", async (_event, payload) => {
  if (typeof payload?.text !== "string" || !payload.text.trim()) throw new Error("Message is empty");
  if (payload.text.length > MAX_AGENT_TURN_CHARS) throw new Error(`Message exceeds the ${MAX_AGENT_TURN_CHARS.toLocaleString("de-DE")} character safety limit.`);
  const workingPhase = payload.assistantMode === "report" ? "structuring" : payload.assistantMode === "correction" ? "reviewing" : "reviewing";
  workflowStore.patch({
    mode: payload.assistantMode || "discussion",
    fieldType: payload.fieldType || undefined,
    fieldLabel: payload.fieldLabel || undefined,
    phase: workingPhase,
    target: payload.targetIdentity ? "selected-field" : "text",
    targetIdentity: payload.targetIdentity || null,
  });
  broadcastWorkflowState();
  const imagePath = payload.imagePath && isLocalCapturePath(payload.imagePath) ? path.resolve(payload.imagePath) : null;
  if (payload.imagePath && !imagePath) throw new Error("Screen image path is not a ReportHalo temporary capture.");
  if (imagePath) {
    if (!pendingCapturePaths.has(imagePath)) throw new Error("The selected screen capture is not owned by this app session. Capture it again.");
    try {
      await fs.access(imagePath);
      pendingCapturePaths.add(imagePath);
    } catch {
      throw new Error("The selected screen capture is no longer available. Capture it again.");
    }
  }
  try {
  const guidedPayload = await applyGuidance(payload);
  if (!currentThreadId) {
    const thread = await (await ensureAgent()).startThread({
      ...guidedPayload,
      model: payload.model,
      medicalGate: payload.medicalGate !== false,
      evidenceMode: Boolean(payload.evidenceMode),
      radiologyMode: payload.radiologyMode !== false,
      imageAttached: Boolean(imagePath),
      assistantMode: payload.assistantMode || "discussion",
    });
    currentThreadId = thread?.thread?.id || thread?.threadId || null;
  }
  log("INFO", "Starting turn", {
    model: payload.model,
    medicalGate: payload.medicalGate !== false,
    evidenceMode: Boolean(payload.evidenceMode),
    radiologyMode: payload.radiologyMode !== false,
    imageAttached: Boolean(imagePath),
    assistantMode: payload.assistantMode || "discussion",
    writingProfile: payload.writingProfile || "off",
  });
    return await (await ensureAgent()).sendTurn({
      ...guidedPayload,
      imagePath,
      threadId: payload.threadId || currentThreadId,
      summary: "none",
      outputSchema: payload.assistantMode === "discussion" ? null : TEXT_ACTION_OUTPUT_SCHEMA,
    });
  } finally {
    if (imagePath) await releaseCapturePath(imagePath);
  }
});

app.on("login", (event, _webContents, _request, authInfo, callback) => {
  const proxy = runtimeProxyOverride;
  if (!authInfo?.isProxy || proxy?.mode !== "fixed_servers" || !proxy.username || !proxy.password) return;
  event.preventDefault();
  callback(proxy.username, proxy.password);
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!helperWindowRef || helperWindowRef.isDestroyed()) return;
    if (helperWindowRef.isMinimized()) helperWindowRef.restore();
    helperWindowRef.showInactive();
    if (process.platform === "win32") helperWindowRef.setFocusable(false);
  });

  app.whenReady().then(async () => {
    try {
      app.setAppLogsPath(path.join(app.getPath("userData"), "logs"));
      configure(app.getPath("logs"));
      log("INFO", `${APP_NAME} starting`, { version: app.getVersion(), platform: process.platform, arch: process.arch });
      session.defaultSession.setPermissionCheckHandler((_webContents, permission, _requestingOrigin, details) => {
        return permission === "media" && Array.isArray(details?.mediaTypes) && details.mediaTypes.includes("audio");
      });
      session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
        callback(permission === "media" && Array.isArray(details?.mediaTypes) && details.mediaTypes.includes("audio"));
      });
      await ensureGuidanceProfile();
      await ensureTemplateLibrary();
      await createHelperWindow();
      registerHelperShortcuts();
      broadcastWorkflowState();
      sendToRenderer("agent:ready", { appName: APP_NAME, ...getBackendInfo() });
      void ensureAgent().then(() => {
        sendToRenderer("agent:ready", { appName: APP_NAME, ...getBackendInfo() });
      }).catch((error) => {
        log("ERROR", `${getBackendInfo().label} startup failed`, { message: error?.message || String(error) });
        sendToRenderer("agent:error", { message: error instanceof Error ? error.message : String(error) });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("ERROR", `${APP_NAME} startup failed`, { message });
      dialog.showErrorBox(APP_NAME, `ReportHalo konnte nicht gestartet werden.\n\n${message}\n\nDetails stehen im lokalen App-Log.`);
      app.quit();
    }
  });
}

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  globalShortcut.unregisterAll();
  void cleanupCapturePaths().finally(() => {
    if (agentClient) agentClient.close();
    app.quit();
  });
});
