const path = require("node:path");
const { app, BrowserWindow } = require("electron");

app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-setuid-sandbox");

app.whenReady().then(async () => {
  const windowRef = new BrowserWindow({
    show: false,
    width: 380,
    height: 380,
    transparent: true,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "renderer-smoke-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  windowRef.webContents.once("did-finish-load", async () => {
    try {
      const result = await windowRef.webContents.executeJavaScript(`(() => {
        const field = document.querySelector("#helperFieldType");
        field.value = "beurteilung";
        field.dispatchEvent(new Event("change"));
        document.querySelector("#helperResult").value = "Befund:\\nKeine Fraktur.\\n\\nBeurteilung:\\nKeine Fraktur nachweisbar.";
        return ({
        helperMode: document.body.classList.contains("helper-mode"),
        helperPanel: Boolean(document.querySelector("#helperPanel")),
        helperPanelVisible: getComputedStyle(document.querySelector("#helperPanel")).display !== "none",
        helperCore: Boolean(document.querySelector("#helperCoreStatus")),
        legacyHelperMoons: document.querySelectorAll(".helper-moon").length,
        helperViewSwitch: Boolean(document.querySelector("#helperVerticalMode") && document.querySelector("#helperMiniMode")),
        fieldType: document.querySelector("#helperFieldType")?.value || null,
        selectedFieldExtraction: typeof extractHelperFieldText === "function" ? extractHelperFieldText(document.querySelector("#helperResult").value) : null,
        centerMenu: Boolean(document.querySelector("#helperMenu")),
        fieldCapture: Boolean(document.querySelector("#helperCaptureMoon")),
        fieldLock: Boolean(document.querySelector("#helperLockField")),
        fieldRelease: Boolean(document.querySelector("#helperReleaseField")),
        dictationBox: Boolean(document.querySelector("#helperInput")),
        dictationTransfer: Boolean(document.querySelector("#helperTransfer")),
        reportStructure: Boolean(document.querySelector("#helperStructure")),
        desktopDiscussion: Boolean(document.querySelector("#helperOpenMain")),
        writeBack: Boolean(document.querySelector("#helperWriteBack")),
        fullAppButton: Boolean(document.querySelector("#helperOpenMain"))
        });
      })()`);
      console.log(JSON.stringify(result));
      windowRef.close();
      app.quit();
    } catch (error) {
      console.error(error.stack || error.message);
      app.exit(1);
    }
  });
  await windowRef.loadFile(path.join(__dirname, "..", "src", "renderer", "index.html"), { query: { mode: "helper" } });
});
