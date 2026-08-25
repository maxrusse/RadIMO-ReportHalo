const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow } = require("electron");

app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-setuid-sandbox");
app.on("window-all-closed", (event) => event.preventDefault());

async function capture(mode, output, width, height) {
  const windowRef = new BrowserWindow({
    show: false,
    width,
    height,
    transparent: mode === "helper",
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "renderer-smoke-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const page = pathToFileURL(path.join(__dirname, "..", "src", "renderer", "index.html")).href;
  await windowRef.loadURL(mode === "helper" ? `${page}?mode=helper` : page);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const image = await windowRef.webContents.capturePage();
  await fs.writeFile(output, image.toPNG());
  windowRef.destroy();
}

app.whenReady().then(async () => {
  try {
    await capture("full", "/tmp/radimoagent-full.png", 1320, 860);
    await capture("helper", "/tmp/radimoagent-helper.png", 450, 700);
    app.quit();
  } catch (error) {
    console.error(error.stack || error.message);
    app.exit(1);
  }
});
