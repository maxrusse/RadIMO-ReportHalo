const path = require("node:path");
const fs = require("node:fs/promises");
const { app, BrowserWindow, clipboard, dialog } = require("electron");
const { scanFieldWindow } = require("./windows-field-bridge");
const {
  buildFieldMapReport,
  loadFieldMapperProfile,
  parseRuleText,
  profileSummary,
  saveFieldMapperProfile,
} = require("./windows-field-mapper");

const APP_NAME = "RadIMO - ReportHalo Field Mapper";
let mapperWindow = null;
let profileLoaded = null;
let lastTargetWindowHandle = "";
let quitting = false;

function waitForExternalFocus() {
  return new Promise((resolve) => setTimeout(resolve, 140));
}

function nativeWindowHandle() {
  try {
    const value = mapperWindow?.getNativeWindowHandle();
    if (!value?.length) return "";
    return value.length >= 8 ? value.readBigUInt64LE(0).toString() : String(value.readUInt32LE(0));
  } catch {
    return "";
  }
}

function trustedSender(event) {
  return Boolean(mapperWindow && !mapperWindow.isDestroyed() && event?.sender === mapperWindow.webContents);
}

function register(channel, handler) {
  return require("electron").ipcMain.handle(channel, (event, ...args) => {
    if (!trustedSender(event)) throw new Error("Unzulässiger IPC-Absender.");
    return handler(event, ...args);
  });
}

async function ensureProfile({ reload = false } = {}) {
  if (!profileLoaded || reload) profileLoaded = loadFieldMapperProfile(app.getPath("userData"));
  return profileLoaded;
}

function send(channel, payload) {
  if (mapperWindow && !mapperWindow.isDestroyed()) mapperWindow.webContents.send(channel, payload);
}

async function runScan({ readValues = false, windowHandle = "" } = {}) {
  const profile = await ensureProfile();
  const requestedWindow = windowHandle === null ? "" : String(windowHandle || lastTargetWindowHandle || "");
  const releaseMapper = !requestedWindow && mapperWindow && !mapperWindow.isDestroyed() && mapperWindow.isVisible();
  const wasFocusable = releaseMapper && typeof mapperWindow.isFocusable === "function" ? mapperWindow.isFocusable() : false;
  if (releaseMapper) mapperWindow.setFocusable(false);
  if (releaseMapper) mapperWindow.hide();
  if (releaseMapper) await waitForExternalFocus();
  let raw;
  try {
    raw = await scanFieldWindow({
      windowHandle: requestedWindow,
      helperWindowHandle: nativeWindowHandle(),
      helperProcessId: process.pid,
      accessMode: "uia",
      profile,
      readValues,
    });
  } finally {
    if (releaseMapper && mapperWindow && !mapperWindow.isDestroyed()) {
      mapperWindow.setFocusable(wasFocusable);
      mapperWindow.showInactive();
    }
  }
  if (!raw?.ok) return raw;
  if (raw.windowHandle) lastTargetWindowHandle = String(raw.windowHandle);
  return buildFieldMapReport(raw, profile, { readValues });
}

async function createWindow() {
  if (mapperWindow && !mapperWindow.isDestroyed()) return mapperWindow;
  mapperWindow = new BrowserWindow({
    width: 760,
    height: 820,
    minWidth: 620,
    minHeight: 620,
    show: false,
    title: APP_NAME,
    backgroundColor: "#07151d",
    webPreferences: {
      preload: path.join(__dirname, "field-mapper-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mapperWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mapperWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mapperWindow.once("ready-to-show", () => mapperWindow.show());
  mapperWindow.on("closed", () => { mapperWindow = null; });
  await mapperWindow.loadFile(path.join(__dirname, "field-mapper.html"));
  return mapperWindow;
}

register("field-mapper:status", async () => profileSummary(await ensureProfile(), app.getPath("userData")));
register("field-mapper:set-config", async (_event, payload) => {
  profileLoaded = await saveFieldMapperProfile(app.getPath("userData"), parseRuleText(payload?.includeText, payload?.excludeText));
  return profileSummary(profileLoaded, app.getPath("userData"));
});
register("field-mapper:scan", async (_event, payload) => runScan({
  readValues: payload?.readValues === true,
  windowHandle: payload?.windowHandle,
}));
register("field-mapper:copy", (_event, value) => {
  clipboard.writeText(String(value || ""));
  return true;
});
register("field-mapper:save-report", async (_event, value) => {
  const report = String(value || "");
  if (!report.trim()) return null;
  const result = await dialog.showSaveDialog(mapperWindow, {
    title: "Field Mapper report speichern",
    defaultPath: "reporthalo-field-map.txt",
    filters: [{ name: "Text report", extensions: ["txt"] }, { name: "All files", extensions: ["*"] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, report, "utf8");
  return { filePath: result.filePath, bytes: Buffer.byteLength(report) };
});
register("field-mapper:quit", () => { app.quit(); return true; });

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => { if (mapperWindow && !mapperWindow.isDestroyed()) mapperWindow.show(); });
  app.whenReady().then(async () => {
    await ensureProfile();
    await createWindow();
  }).catch((error) => {
    dialog.showErrorBox(APP_NAME, error?.message || String(error));
    app.quit();
  });
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    app.quit();
  });
  app.on("window-all-closed", () => app.quit());
}
