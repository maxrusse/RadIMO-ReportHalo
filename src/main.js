const path = require("node:path");
const { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, nativeImage, net, screen, session, shell } = require("electron");
const { CodexAppServer } = require("./codex-app-server");
const { findAdjacentContext, formatContextReport } = require("./context-finder");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const os = require("node:os");
const { configure, getLogPath, log, readLog } = require("./logger");
const { resolveCodexBinary } = require("./platform");
const { readFocusedField, writeFocusedField } = require("./windows-field-bridge");
const { proxyEndpointFromInternetSettings, readWindowsInternetSettings } = require("./windows-proxy");
const { applyCodexProxy } = require("./codex-proxy-env");
const { readReferencePack, readReferenceUrl } = require("./reference-library");
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

const APP_NAME = "RadimoAgent";
let windowRef = null;
let codex = null;
let codexStartPromise = null;
let currentThreadId = null;
let helperWindowRef = null;
let runtimeProxyOverride = null;
let snipWindowRef = null;
let pendingSnip = null;
let snipCompleting = false;
let guidanceLoaded = null;
let templateLibraryLoaded = null;
const pendingCapturePaths = new Set();
const workflowStore = createWorkflowStore();

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

async function applyGuidance(options = {}) {
  const loaded = await ensureGuidanceProfile();
  const writingProfile = options.writingProfile || "off";
  return {
    ...options,
    writingGuidance: writingProfile === "german-radiology" ? formatGuidancePrompt(loaded.profile) : "",
  };
}

function proxyEndpointFromRules(rules) {
  if (typeof rules !== "string") return null;
  const match = rules.match(/(?:PROXY|HTTPS|HTTP|SOCKS5?|SOCKS)\s+([^;\s]+)/i);
  if (!match) return null;
  const endpoint = match[1];
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint)) return endpoint;
  return /^socks/i.test(match[0]) ? `socks5://${endpoint}` : `http://${endpoint}`;
}

async function resolveCodexEnvironment() {
  const env = { ...process.env };
  const explicitProxy = runtimeProxyOverride || env.RADIMOAGENT_HTTPS_PROXY || env.RADIMOAGENT_HTTP_PROXY;
  if (explicitProxy) {
    const noProxyAdjusted = applyCodexProxy(env, explicitProxy);
    log("INFO", "Using explicit RadimoAgent proxy override for Codex", { configured: true, noProxyAdjusted });
    return env;
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
  if (!env.HTTPS_PROXY && !env.https_proxy && !env.HTTP_PROXY && !env.http_proxy) {
    const settings = await readWindowsInternetSettings();
    const proxy = proxyEndpointFromInternetSettings(settings);
    if (proxy) {
      const noProxyAdjusted = applyCodexProxy(env, proxy);
      log("INFO", "Applied Windows Internet Settings proxy for Codex", {
        configured: true,
        pacConfigured: Boolean(settings?.autoConfigUrl),
        noProxyAdjusted,
      });
    } else if (settings?.autoConfigUrl) {
      log("WARN", "Windows Internet Settings uses a PAC URL without a directly resolved proxy", { pacConfigured: true });
    }
  }
  return env;
}

function validateProxyOverride(value) {
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Proxy must look like http://proxy:port, https://proxy:port, or socks5://proxy:port.");
  }
  if (!["http:", "https:", "socks5:", "socks5h:", "socks:", "socks4:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error("Proxy must use http, https, socks, socks4, or socks5 and include a host.");
  }
  return value;
}

function proxyWithCredentials(value, username, password) {
  const base = validateProxyOverride(value);
  const user = String(username || "");
  const secret = String(password || "");
  if (!user && !secret) return base;
  if (!user || !secret) throw new Error("Enter both proxy username and proxy password, or leave both blank.");
  const parsed = new URL(base);
  parsed.username = user;
  parsed.password = secret;
  return parsed.toString();
}

async function restartCodexWithProxy(value) {
  const request = typeof value === "object" && value !== null ? value : { url: value };
  runtimeProxyOverride = proxyWithCredentials(
    String(request.url || "").trim(),
    request.username,
    request.password,
  );
  if (codex) {
    codex.close();
    codex = null;
  }
  codexStartPromise = null;
  currentThreadId = null;
  await ensureCodex();
  log("INFO", "Codex restarted after proxy change", { configured: Boolean(runtimeProxyOverride) });
  return { configured: Boolean(runtimeProxyOverride) };
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
  const settings = await readWindowsInternetSettings();
  return settings ? {
    enabled: settings.enabled,
    serverConfigured: Boolean(settings.server),
    pacConfigured: Boolean(settings.autoConfigUrl),
  } : null;
}

function sendToRenderer(channel, payload) {
  for (const target of [windowRef, helperWindowRef]) {
    if (target && !target.isDestroyed()) target.webContents.send(channel, payload);
  }
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

function createWindow() {
  windowRef = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1120,
    minHeight: 740,
    title: APP_NAME,
    backgroundColor: "#07111f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windowRef.loadFile(path.join(__dirname, "renderer", "index.html"));
  windowRef.on("closed", () => { windowRef = null; });
}

async function ensureCodex() {
  if (!codex) {
    const env = await resolveCodexEnvironment();
    const client = new CodexAppServer({
      cwd: app.getPath("documents"),
      env,
      onNotification: (message) => {
        sendToRenderer("agent:event", message);
        log(message.method === "radimoagent/stderr" ? "WARN" : "INFO", message.method || "Codex event", message.params);
        if (message.method === "turn/completed") {
          workflowStore.patch({ phase: "ready" });
          broadcastWorkflowState();
          cleanupCapturePaths();
        }
      },
    });
    codex = client;
    codexStartPromise = client.start().catch((error) => {
      codex = null;
      throw error;
    }).finally(() => { codexStartPromise = null; });
  }
  if (codexStartPromise) await codexStartPromise;
  return codex;
}

function createHelperWindow() {
  if (helperWindowRef && !helperWindowRef.isDestroyed()) {
    helperWindowRef.showInactive();
    return helperWindowRef;
  }
  helperWindowRef = new BrowserWindow({
    width: 450,
    height: 700,
    center: true,
    minWidth: 360,
    minHeight: 360,
    maxWidth: 620,
    maxHeight: 820,
    frame: false,
    transparent: true,
    show: false,
    focusable: process.platform !== "win32",
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: `${APP_NAME} Helper`,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  helperWindowRef.setAlwaysOnTop(true, "floating");
  if (process.platform === "win32") helperWindowRef.setFocusable(false);
  helperWindowRef.loadFile(path.join(__dirname, "renderer", "index.html"), { query: { mode: "helper" } });
  helperWindowRef.webContents.once("did-finish-load", () => {
    helperWindowRef.showInactive();
    if (codex) sendToRenderer("agent:ready", { appName: `${APP_NAME} Helper` });
  });
  helperWindowRef.on("closed", () => { helperWindowRef = null; });
  return helperWindowRef;
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
  return { ok: true, dataUrl: cropped.toDataURL(), path: capturePath, width: crop.width, height: crop.height };
}

ipcMain.handle("screen:snip", async () => {
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

ipcMain.handle("snip:finish", async (_event, rect) => {
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

ipcMain.handle("snip:cancel", () => {
  if (pendingSnip) pendingSnip.resolve(null);
  pendingSnip = null;
  closeSnipWindow();
  return true;
});

ipcMain.handle("snip:copy", (_event, dataUrl) => {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return false;
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) return false;
  clipboard.writeImage(image);
  log("INFO", "Screen capture copied to clipboard", { width: image.getSize().width, height: image.getSize().height });
  return true;
});

ipcMain.handle("agent:status", async () => {
  const client = await ensureCodex();
  return client.authStatus();
});

ipcMain.handle("agent:browser-login", async () => {
  const client = await ensureCodex();
  log("INFO", "Starting ChatGPT browser login");
  try {
    const result = await client.startBrowserLogin();
    if (result?.authUrl) await shell.openExternal(result.authUrl);
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

ipcMain.handle("agent:logout", async () => {
  const result = await (await ensureCodex()).logout();
  currentThreadId = null;
  return result;
});
ipcMain.handle("agent:models", async () => (await ensureCodex()).listModels());
ipcMain.handle("agent:open-url", async (_event, url) => {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});
ipcMain.handle("agent:diagnostics", async () => ({
  path: getLogPath(),
  text: await readLog(),
  proxyRules: await session.defaultSession.resolveProxy("https://auth.openai.com/").catch((error) => `ERROR: ${error.message}`),
  proxyOverrideConfigured: Boolean(runtimeProxyOverride || process.env.RADIMOAGENT_HTTPS_PROXY || process.env.RADIMOAGENT_HTTP_PROXY),
  windowsProxy: await windowsProxyDiagnostics(),
  authEndpoint: await probeAuthEndpoint(),
  runtime: {
    app: APP_NAME,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    codex: codex?.bin || resolveCodexBinary(),
    hostname: os.hostname(),
  },
}));
ipcMain.handle("agent:copy-diagnostics", async () => {
  const diagnostics = await (async () => ({
    path: getLogPath(),
    proxyRules: await session.defaultSession.resolveProxy("https://auth.openai.com/").catch((error) => `ERROR: ${error.message}`),
    proxyOverrideConfigured: Boolean(runtimeProxyOverride || process.env.RADIMOAGENT_HTTPS_PROXY || process.env.RADIMOAGENT_HTTP_PROXY),
    windowsProxy: await windowsProxyDiagnostics(),
    authEndpoint: await probeAuthEndpoint(),
    runtime: {
      app: APP_NAME,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      node: process.versions.node,
      codex: codex?.bin || resolveCodexBinary(),
    },
    text: await readLog(),
  }))();
  const text = [
    "RadimoAgent diagnostics",
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
ipcMain.handle("agent:test-connection", async () => {
  const proxyRules = await session.defaultSession.resolveProxy("https://auth.openai.com/").catch((error) => `ERROR: ${error.message}`);
  return {
    proxyRules,
    proxyEndpoint: proxyEndpointFromRules(proxyRules),
    authEndpoint: await probeAuthEndpoint(),
    proxyOverrideConfigured: Boolean(runtimeProxyOverride || process.env.RADIMOAGENT_HTTPS_PROXY || process.env.RADIMOAGENT_HTTP_PROXY),
    windowsProxy: await windowsProxyDiagnostics(),
  };
});
ipcMain.handle("agent:set-proxy", async (_event, value) => restartCodexWithProxy(value));
ipcMain.handle("guidance:status", async () => profileSummary(await ensureGuidanceProfile()));
ipcMain.handle("templates:status", async () => templateSummary(await ensureTemplateLibrary()));
ipcMain.handle("templates:get", async (_event, id) => {
  const library = await ensureTemplateLibrary();
  return library.templates.find((template) => template.id === id) || null;
});
ipcMain.handle("guidance:import", async () => {
  const result = await dialog.showOpenDialog(windowRef, {
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
ipcMain.handle("guidance:export", async () => {
  const loaded = await ensureGuidanceProfile();
  const result = await dialog.showSaveDialog(windowRef, {
    title: "Export German radiology writing profile",
    defaultPath: "german-radiology-profile.md",
    filters: [{ name: "Markdown profile", extensions: ["md"] }],
  });
  if (result.canceled || !result.filePath) return null;
  const content = serializeGuidanceMarkdown(loaded.profile);
  await fs.writeFile(result.filePath, content, "utf8");
  return { filePath: result.filePath, bytes: Buffer.byteLength(content) };
});
ipcMain.handle("guidance:open-folder", async () => {
  const folder = profileDirectory(app.getPath("userData"));
  await fs.mkdir(folder, { recursive: true });
  await shell.openPath(folder);
  return folder;
});
ipcMain.handle("clipboard:read", () => clipboard.readText());
ipcMain.handle("clipboard:write", (_event, text) => {
  if (typeof text !== "string") throw new Error("Clipboard content must be text.");
  clipboard.writeText(text);
  return true;
});
ipcMain.handle("field:read-focused", async (_event, options) => {
  const result = await readFocusedField(options || {});
  log(result?.ok ? "INFO" : "WARN", "Focused field capture", {
    ok: Boolean(result?.ok),
    strategy: result?.strategy || null,
    supportsWrite: Boolean(result?.supportsWrite),
    error: result?.error || null,
  });
  return result;
});
ipcMain.handle("field:write-focused", async (_event, payload) => {
  if (!payload || typeof payload.text !== "string") return { ok: false, verified: false, error: "empty-text" };
  const previousText = clipboard.readText();
  const previousHasImage = !clipboard.readImage().isEmpty();
  clipboard.writeText(payload.text);
  try {
    const result = await writeFocusedField(payload);
    log(result?.ok ? "INFO" : "WARN", "Focused field write", {
      ok: Boolean(result?.ok),
      verified: Boolean(result?.verified),
      error: result?.error || null,
    });
    return result;
  } finally {
    if (!previousHasImage) clipboard.writeText(previousText);
  }
});
ipcMain.handle("workflow:get", () => workflowStore.get());
ipcMain.handle("workflow:new-case", (_event, payload) => {
  const result = workflowStore.startCase(payload || {});
  broadcastWorkflowState();
  return result;
});
ipcMain.handle("workflow:patch", (_event, payload) => {
  const result = workflowStore.patch(payload || {});
  broadcastWorkflowState();
  return result;
});
ipcMain.handle("workflow:add-artifact", (_event, payload) => {
  const result = workflowStore.addArtifact(payload || {});
  broadcastWorkflowState();
  log("INFO", "Workflow artifact added", {
    caseId: result.caseId,
    kind: payload?.kind || "draft",
    chars: typeof payload?.text === "string" ? payload.text.length : 0,
  });
  return result;
});
ipcMain.handle("ui:set-helper-focusable", (_event, value) => {
  if (helperWindowRef && !helperWindowRef.isDestroyed() && process.platform === "win32") helperWindowRef.setFocusable(Boolean(value));
  return true;
});
ipcMain.handle("ui:toggle-helper", () => {
  if (helperWindowRef && !helperWindowRef.isDestroyed() && helperWindowRef.isVisible()) {
    helperWindowRef.hide();
    return false;
  }
  createHelperWindow();
  return true;
});
ipcMain.handle("ui:show-main", (_event, payload) => {
  if (windowRef && !windowRef.isDestroyed()) {
    windowRef.show();
    windowRef.focus();
    if (payload?.text) {
      if (payload.fresh !== false) currentThreadId = null;
      workflowStore.startCase({ origin: "helper", fieldType: payload.fieldType || "befund", fieldLabel: payload.fieldLabel || "Befund" });
      workflowStore.patch({ mode: payload.mode || "discussion", phase: "reviewing", target: "desktop" });
      workflowStore.addArtifact({ kind: "discussion-input", label: "Arbeitsgrundlage", detail: "Vom Helfer übergeben · nur für Diskussion", text: payload.text, source: "helper" });
      broadcastWorkflowState();
      windowRef.webContents.send("workflow:open", { text: payload.text, mode: payload.mode || "discussion", fresh: payload.fresh !== false, fieldType: payload.fieldType || null, fieldLabel: payload.fieldLabel || null });
    }
  }
  return true;
});
ipcMain.handle("ui:hide-helper", () => {
  if (helperWindowRef && !helperWindowRef.isDestroyed()) helperWindowRef.hide();
  return true;
});

ipcMain.handle("context:choose", async () => {
  const result = await dialog.showOpenDialog(windowRef, {
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

ipcMain.handle("context:save-report", async (_event, report) => {
  if (!report || typeof report !== "object" || !report.source?.path) throw new Error("No context report is available.");
  const result = await dialog.showSaveDialog(windowRef, {
    title: "Save RadimoAgent context report",
    defaultPath: "radimoagent-context-beta-report.md",
    filters: [{ name: "Markdown report", extensions: ["md"] }, { name: "Text report", extensions: ["txt"] }],
  });
  if (result.canceled || !result.filePath) return null;
  const reportText = formatContextReport(report);
  await fs.writeFile(result.filePath, reportText, "utf8");
  return { filePath: result.filePath, bytes: Buffer.byteLength(reportText) };
});
ipcMain.handle("context:save-draft", async (_event, payload) => {
  if (!payload?.sourcePath || typeof payload.content !== "string" || !payload.content.trim()) throw new Error("No reviewed correction draft is available.");
  const source = path.resolve(payload.sourcePath);
  const parsed = path.parse(source);
  const result = await dialog.showSaveDialog(windowRef, {
    title: "Save reviewed RadimoAgent draft",
    defaultPath: path.join(parsed.dir, `${parsed.name}.radimoagent-draft${parsed.ext || ".txt"}`),
    filters: [{ name: "Text draft", extensions: [parsed.ext.replace(".", "") || "txt"] }, { name: "All files", extensions: ["*"] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, payload.content, "utf8");
  log("INFO", "Reviewed correction draft saved", { filePath: result.filePath });
  return { filePath: result.filePath, bytes: Buffer.byteLength(payload.content) };
});

ipcMain.handle("reference:choose", async () => {
  const result = await dialog.showOpenDialog(windowRef, {
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

ipcMain.handle("reference:fetch-url", async (_event, value) => {
  const reference = await readReferenceUrl(value, (url, options) => net.fetch(url, options));
  log("INFO", "Medical reference URL fetched locally", {
    host: new URL(reference.url).hostname,
    status: reference.status,
    chars: reference.content.length,
  });
  return reference;
});

ipcMain.handle("agent:thread", async (_event, options) => {
  const result = await (await ensureCodex()).startThread(await applyGuidance(options || {}));
  currentThreadId = result?.thread?.id || result?.threadId || null;
  return result;
});

ipcMain.handle("agent:new-discussion", async (_event, options) => {
  currentThreadId = null;
  const result = await (await ensureCodex()).startThread(await applyGuidance({
    ...(options || {}),
    assistantMode: "discussion",
  }));
  currentThreadId = result?.thread?.id || result?.threadId || null;
  log("INFO", "Started new open discussion", { model: options?.model || null });
  return result;
});

ipcMain.handle("agent:turn", async (_event, payload) => {
  if (!payload?.text?.trim()) throw new Error("Message is empty");
  const workingPhase = payload.assistantMode === "report" ? "structuring" : payload.assistantMode === "correction" ? "reviewing" : "reviewing";
  workflowStore.patch({
    origin: payload.origin === "helper" ? "helper" : "desktop",
    mode: payload.assistantMode || "discussion",
    fieldType: payload.fieldType || undefined,
    fieldLabel: payload.fieldLabel || undefined,
    phase: workingPhase,
    target: payload.origin === "helper" ? "selected-field" : "desktop",
    targetIdentity: payload.targetIdentity || undefined,
  });
  broadcastWorkflowState();
  const imagePath = payload.imagePath && isLocalCapturePath(payload.imagePath) ? path.resolve(payload.imagePath) : null;
  if (payload.imagePath && !imagePath) throw new Error("Screen image path is not a RadimoAgent temporary capture.");
  if (imagePath) {
    try {
      await fs.access(imagePath);
      pendingCapturePaths.add(imagePath);
    } catch {
      throw new Error("The selected screen capture is no longer available. Capture it again.");
    }
  }
  const guidedPayload = await applyGuidance(payload);
  if (!currentThreadId) {
    const thread = await (await ensureCodex()).startThread({
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
  return (await ensureCodex()).sendTurn({ ...guidedPayload, imagePath, threadId: payload.threadId || currentThreadId });
});

app.whenReady().then(async () => {
  app.setAppLogsPath(path.join(app.getPath("userData"), "logs"));
  configure(app.getPath("logs"));
  log("INFO", "RadimoAgent starting", { version: app.getVersion(), platform: process.platform, arch: process.arch });
  await ensureGuidanceProfile();
  await ensureTemplateLibrary();
  createWindow();
  broadcastWorkflowState();
  try {
    await ensureCodex();
    sendToRenderer("agent:ready", { appName: APP_NAME });
  } catch (error) {
    log("ERROR", "Codex app-server startup failed", { message: error?.message || String(error) });
    sendToRenderer("agent:error", { message: error instanceof Error ? error.message : String(error) });
  }
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { cleanupCapturePaths(); if (codex) codex.close(); });
